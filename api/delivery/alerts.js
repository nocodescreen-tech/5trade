/**
 * 5trade — alertes : prévenir HORS de la page quand un signal se confirme.
 *
 * Le problème résolu : un signal confirmé qui n'existe que dans un onglet ouvert
 * ne sert à rien — on regarde ailleurs, on dort, on rate l'entrée. Ce module
 * surveille des marchés en continu et envoie un email au premier signal
 * confirmé, UNE SEULE FOIS par signal (clé = source + marché + unité de temps
 * + sens + bougie de déclenchement). La même configuration de signal ne
 * redéclenche donc jamais deux fois le même email.
 *
 * Les dépendances (Market, Signals, sendMail) sont INJECTÉES : le module reste
 * testable seul, et il n'y a pas de cycle d'import avec server.js.
 */
const fs = require('fs');
const path = require('path');
// Le reseau met parfois 9 s a joindre Telegram : sans reprise, l'alerte est perdue.
const { fetchAvecReprise } = require('../core/reseau');
// Constructeur de payload push pur (aucun effet de bord) : l'envoi passe
// par deps.sendPush injecté, comme sendMail.
const { payloadSignal } = require('./pushAlerts');

// Dossier résolu par dossiers.js : sur un PaaS le code est monté en lecture
// seule, et écrire dans /app/data échouait en EROFS à chaque sauvegarde de
// configuration (« Alertes : enregistrement impossible »).
const { DATA_DIR } = require('../core/dossiers');
// Le fichier de configuration est surchargeable par l'environnement.
// POURQUOI : la suite de tests faisait Al.update({ actif: false, email: null })
// sur le VRAI fichier — lancer le canonique effaçait donc la configuration de
// l'utilisateur (surveillance éteinte, email vidé, marchés remplacés par un
// marché de test). Les tests écrivent désormais dans un fichier à part.
// Chemin résolu À CHAQUE APPEL, pas au chargement : sinon ALERTS_FICHIER posé
// plus tard (tests) était ignoré et la suite réécrivait la graine versionnée.
const fichierAlertes = () => process.env.ALERTS_FICHIER || path.join(DATA_DIR, 'alerts.json');

/** Configuration par défaut : surveillance inactive tant qu'aucun email n'est posé. */
const DEFAUT = {
  actif: false,
  email: null,               // destinataire (par défaut : l'email du compte)
  forceMin: 0.5,             // n'alerter qu'au-delà de cette force
  intervalleSec: 60,         // fréquence de contrôle
  // Cooldown par signal (marché + unité + direction + motifs) : un même setup ne
  // repart pas toutes les minutes. 0 = pas de cooldown (dédoublonnage permanent).
  cooldownMin: 30,
  // ── Garde-fous de fiabilité ──────────────────────────────────────────────
  // Un signal confirmé sur une seule unité de temps, ou qui va contre le
  // contexte supérieur, n'a rien à faire dans une boîte mail : c'est du bruit.
  exigerAlignement: true,    // les unités de temps doivent aller dans le même sens
  seuilAlignes: 2,           // combien d'unités doivent être d'accord
  refuserContreTendance: true, // pas d'alerte contre le contexte supérieur
  refuserDesaccord: true,    // pas d'alerte quand les règles se contredisent
  rrMin: 1.5,                // rapport gain/risque minimum (0 = pas de contrôle)
  // ── Réception ────────────────────────────────────────────────────────────
  // L'email seul oblige à surveiller sa boîte. Telegram prévient sur le
  // téléphone, tout de suite.
  telegramToken: null,       // jeton du bot (BotFather)
  telegramChat: null,        // identifiant de la conversation
  // Stratégies à appliquer PENDANT la surveillance. Vide = mode auto (toutes
  // les règles). Renseigné = chaque stratégie est évaluée séparément et l'alerte
  // dit laquelle s'est déclenchée. Sans ce champ, la surveillance ignorait
  // complètement les stratégies configurées dans l'app.
  strategies: [],
  marches: [
    { symbol: 'frxXAUUSD', tf: '15m', provider: 'deriv' },
    { symbol: 'R_75', tf: '15m', provider: 'deriv' },
    { symbol: 'BTCUSDT', tf: '15m', provider: 'binance' }
  ],
  derniers: [],              // 50 dernières alertes envoyées
  deja: [],                   // 200 dernières clés déjà notifiées (anti-doublon)
  dejaAt: {},                 // clé → horodatage, pour le cooldown
  abonnements: []            // abonnements push navigateur [{ endpoint, keys, at }]
};

let config = { ...DEFAUT };
let deps = null;
let timer = null;

// Secrets : sur un PaaS le disque est éphémère (et le dépôt peut être public),
// donc le jeton du bot ne doit pas dépendre d'un fichier. L'environnement gagne
// toujours — y compris après relecture en base, sinon un jeton posé en variable
// serait écrasé par une vieille config.
function appliquerEnvironnement() {
  if (process.env.TELEGRAM_TOKEN) config.telegramToken = process.env.TELEGRAM_TOKEN.trim();
  if (process.env.TELEGRAM_CHAT) config.telegramChat = process.env.TELEGRAM_CHAT.trim();
  return config;
}

function load() {
  try {
    if (fs.existsSync(fichierAlertes())) {
      const disque = JSON.parse(fs.readFileSync(fichierAlertes(), 'utf8'));
      config = { ...DEFAUT, ...disque };
    }
  } catch (e) {
    console.error('   Alertes    : configuration illisible —', e.message);
  }
  return appliquerEnvironnement();
}

function save() {
  // Quand PostgreSQL fait foi, le fichier n'est qu'un cache de démarrage : l'écrire
  // réécrivait la graine versionnée à chaque lancement local (arbre de travail
  // sale, risque de committer une config de test). On ne l'écrit qu'en mode
  // fichiers, ou si ALERTS_FICHIER désigne explicitement un autre chemin.
  // DATABASE_URL suffit : le module est chargé AVANT DB.init(), donc isPg() est
  // encore faux à ce moment-là et le fichier était réécrit au démarrage.
  const dbPg = Boolean(process.env.DATABASE_URL)
    || (() => { try { return require('../core/db').isPg(); } catch { return false; } })();
  const cheminImpose = Boolean(process.env.ALERTS_FICHIER);
  if (!dbPg || cheminImpose) {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(fichierAlertes(), JSON.stringify(config, null, 2));
    } catch (e) {
      console.error('   Alertes    : enregistrement impossible —', e.message);
    }
  }
  // Persistance en base : sur un PaaS le disque est éphémère, donc une config
  // saisie dans l'interface disparaissait au redéploiement (jeton Telegram,
  // stratégies surveillées, marchés). On la recopie en base, sans bloquer.
  try {
    const DB = require('../core/db');
    if (DB.isPg()) {
      DB.kvEcrire('alertes', config).catch(() => { /* la config locale reste valable */ });
    }
  } catch { /* pas de base : le fichier suffit */ }
}

/**
 * Reprend la configuration depuis la base si elle y est : c'est elle qui survit
 * aux déploiements, le fichier n'est qu'un cache local.
 */
async function hydrater() {
  try {
    const DB = require('../core/db');
    if (!DB.isPg()) return false;
    const depuisBase = await DB.kvLire('alertes', null);
    if (!depuisBase || typeof depuisBase !== 'object') return false;
    config = { ...DEFAUT, ...depuisBase };
    // L'environnement reste prioritaire sur une config relue en base.
    appliquerEnvironnement();
    // Cache local : inutile — et nuisible — quand PostgreSQL fait foi. L'écrire
    // réécrivait la graine versionnée à chaque démarrage (arbre sale, config de
    // base recopiée dans le dépôt). On ne l'écrit que si le fichier est la source
    // (mode fichiers) ou si un chemin a été imposé (tests).
    const cheminImpose = Boolean(process.env.ALERTS_FICHIER);
    if (cheminImpose) {
      try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(fichierAlertes(), JSON.stringify(config, null, 2));
      } catch { /* le cache local est secondaire */ }
    }
    return true;
  } catch (e) {
    console.error('   Alertes    : relecture en base impossible —', e.message);
    return false;
  }
}

/** Diagnostic lisible : sert à répondre à « pourquoi je ne reçois rien ? ». */
function diagnostic() {
  const c = config;
  const manques = [];
  if (!c.actif) manques.push('alertes désactivées');
  if (!c.telegramToken) manques.push('jeton Telegram absent');
  if (!c.telegramChat) manques.push('chat id absent');
  if (!Array.isArray(c.marches) || !c.marches.length) manques.push('aucun marché surveillé');
  return {
    actif: !!c.actif,
    telegram: !!(c.telegramToken && c.telegramChat),
    strategies: (c.strategies || []).length,
    marches: (c.marches || []).length,
    intervalleSec: c.intervalleSec,
    pret: manques.length === 0,
    manques
  };
}

const get = () => config;

/** Met à jour la configuration (validée, jamais de valeur absurde acceptée). */
function update(patch = {}) {
  const c = { ...config };
  if ('actif' in patch) c.actif = !!patch.actif;
  if ('email' in patch) {
    const e = patch.email === null || patch.email === '' ? null : String(patch.email).trim().slice(0, 160);
    if (e && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Adresse email invalide');
    c.email = e;
  }
  if ('forceMin' in patch) {
    const f = Number(patch.forceMin);
    if (!Number.isFinite(f) || f < 0 || f > 1) throw new Error('« forceMin » doit être entre 0 et 1');
    c.forceMin = f;
  }
  if ('exigerAlignement' in patch) c.exigerAlignement = !!patch.exigerAlignement;
  if ('refuserContreTendance' in patch) c.refuserContreTendance = !!patch.refuserContreTendance;
  if ('refuserDesaccord' in patch) c.refuserDesaccord = !!patch.refuserDesaccord;
  if ('cooldownMin' in patch) {
    const v = Math.round(Number(patch.cooldownMin));
    if (!Number.isFinite(v) || v < 0 || v > 1440) throw new Error('« cooldownMin » doit être entre 0 et 1440');
    c.cooldownMin = v;
  }
  if ('seuilAlignes' in patch) {
    const a = Math.round(Number(patch.seuilAlignes));
    if (!Number.isFinite(a) || a < 1 || a > 5) throw new Error('« seuilAlignes » doit être entre 1 et 5');
    c.seuilAlignes = a;
  }
  if ('telegramToken' in patch) {
    const t = patch.telegramToken === null || patch.telegramToken === '' ? null
      : String(patch.telegramToken).trim().slice(0, 200);
    // Un jeton de bot Telegram ressemble a « 123456789:AA... ».
    if (t && !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(t)) throw new Error('Jeton de bot Telegram invalide');
    c.telegramToken = t;
  }
  if ('telegramChat' in patch) {
    c.telegramChat = patch.telegramChat === null || patch.telegramChat === ''
      ? null : String(patch.telegramChat).trim().slice(0, 60);
  }
  if ('rrMin' in patch) {
    const r = Number(patch.rrMin);
    if (!Number.isFinite(r) || r < 0 || r > 10) throw new Error('« rrMin » doit être entre 0 et 10');
    c.rrMin = r;
  }
  if ('intervalleSec' in patch) {
    const i = Math.round(Number(patch.intervalleSec));
    if (!Number.isFinite(i) || i < 15 || i > 3600) throw new Error('« intervalleSec » doit être entre 15 et 3600');
    c.intervalleSec = i;
  }
  if ('marches' in patch) {
    if (!Array.isArray(patch.marches)) throw new Error('« marches » doit être une liste');
    const propres = [];
    for (const m of patch.marches) {
      const symbol = String((m && m.symbol) || '').trim();
      const tf = String((m && m.tf) || '').trim();
      const provider = String((m && m.provider) || '').trim();
      if (!symbol || !tf || !provider) continue;
      if (!propres.some(x => x.symbol === symbol && x.tf === tf && x.provider === provider)) {
        propres.push({ symbol, tf, provider });
      }
    }
    c.marches = propres.slice(0, 20);
  }
  // Stratégies appliquées PENDANT la surveillance. Ce bloc manquait : `update()`
  // reconstruit la config clé par clé, donc une valeur non listée était
  // **silencieusement jetée**. `deps.profilsSurveillance` lisait ensuite un
  // tableau vide et la surveillance retombait en mode auto — le correctif
  // semblait fait et ne l'était pas.
  if ('strategies' in patch) {
    if (!Array.isArray(patch.strategies)) throw new Error('« strategies » doit être une liste');
    c.strategies = [...new Set(
      patch.strategies.map(x => String(x || '').trim()).filter(Boolean)
    )].slice(0, 20);
  }
  config = c;
  save();
  return config;
}

function resetDedup() { config.deja = []; save(); return config; }

/**
 * Construit le message d'alerte. Toutes les valeurs viennent du signal calculé :
 * aucune n'est inventée, et ce qui manque est simplement absent.
 */
/** Message Telegram : court, chiffré, lisible sur un téléphone. */
/**
 * Bloc « signaux détectés » pour Telegram.
 *
 * Le message ne doit pas annoncer UN signal : sur un même graphique, plusieurs
 * stratégies et plusieurs motifs peuvent se déclencher en même temps, chacun avec
 * son sens. Les fondre en une ligne efface ce que le trader a demandé à voir.
 * Chaque ligne porte donc : le nom, la stratégie d'origine (ou le motif), le sens
 * et la force. Les rejetés sont comptés, pas listés (le message resterait
 * illisible) — ils restent visibles dans l'app.
 */
function blocSignaux(multi) {
  if (!multi || !Array.isArray(multi.signaux) || !multi.signaux.length) return '';
  const retenus = multi.signaux.filter(s => s.status === 'confirme' || s.status === 'surveiller');
  if (!retenus.length) {
    return `\n\nAucun signal retenu (${multi.signaux.length} concept(s) évalué(s), tous non remplis).`;
  }
  const lignes = retenus.slice(0, 10).map(s => {
    const src = s.source === 'strategie' ? (s.strategie || s.nom) : s.nom;
    const sens = s.sens === 'long' ? 'achat' : s.sens === 'short' ? 'vente' : 'neutre';
    const etat = s.status === 'confirme' ? '' : ' (à surveiller)';
    return `• <b>${src}</b> — ${sens}${etat} · force ${Math.round((s.force || 0) * 100)} %`;
  });
  const reste = retenus.length > 10 ? `\n… et ${retenus.length - 10} autre(s)` : '';
  return `\n\n<b>Signaux détectés (${retenus.length})</b>\n${lignes.join('\n')}${reste}`;
}

function blocContexte(multi) {
  const k = multi && multi.carte;
  if (!k) return '';
  const tend = k.tendance === 'bullish' ? 'haussière' : k.tendance === 'bearish' ? 'baissière' : 'range';
  const pos = k.position ? k.position.zone : null;
  const z = k.zoneLaPlusProche;
  const morceaux = [
    `tendance ${tend}`,
    pos ? `prix en ${pos}` : null,
    z ? `${z.type} à ${z.distanceAtr} ATR` : null,
    Number.isFinite(k.atr) ? `ATR ${k.atr}` : null
  ].filter(Boolean);
  return morceaux.length ? `\nContexte : ${morceaux.join(' · ')}` : '';
}

function messageTelegram(v, m, qualite = {}) {
  const L = v.levels || {};
  const sens = v.direction === 'BUY' ? 'ACHAT' : 'VENTE';
  const prix = Number.isFinite(Number(v.price)) ? Number(v.price) : null;
  const pct = v.strength ? ` · force ${Math.round(v.strength * 100)} %` : '';
  const nbRegles = Number.isFinite(v.confirmations) ? v.confirmations : (v.rules || []).length;

  // Niveaux : on affiche le prix ET l'écart, en R, parce qu'un prix seul ne dit
  // pas si le stop est à 3 pips ou 30. Un niveau absent est dit absent — la
  // version précédente affichait « — » sans expliquer pourquoi.
  const num = x => (Number.isFinite(Number(x)) ? Number(x) : null);
  // Prix lisibles : « 3861.253698 » sur l'or n'aide personne. Les décimales
  // suivent l'ordre de grandeur (2 sur l'or, 5 sur EURUSD, 3 sur USDJPY).
  const prixTxt = x => {
    const v = Number(x);
    if (!Number.isFinite(v)) return String(x);
    const a = Math.abs(v);
    const d = a >= 1000 ? 2 : a >= 100 ? 3 : a >= 10 ? 3 : 5;
    return v.toFixed(d);
  };
  const entree = num(L.entry) ?? prix;
  const stop = num(L.stop);
  const tp1 = num(L.target1);
  const tp2 = num(L.target2);
  const risque = entree !== null && stop !== null ? Math.abs(entree - stop) : null;
  const enR = cible => (risque && cible !== null ? ` (${((Math.abs(cible - entree)) / risque).toFixed(2)} R)` : '');

  // Dimensionnement dynamique du lot selon capital et risque réel configuré
  let lotTexte = null;
  try {
    const Risque = require('../risk/risque');
    const cfgRisque = Risque.charger();
    const capital = cfgRisque.capital || 1000;
    const risquePct = cfgRisque.risquePct || 1;
    const montantRisque = (capital * risquePct) / 100;
    if (risque && risque > 0) {
      let tickVal = 1;
      let tickTaille = 0.01;
      const s = String(m.symbol || '').toUpperCase();
      if (s.includes('XAU') || s.includes('GOLD')) {
        tickVal = 10;
        tickTaille = 0.1;
      } else if (s.includes('BTC') || s.includes('CRY')) {
        tickVal = 1;
        tickTaille = 1;
      } else if (s.includes('JPY')) {
        tickVal = 1000;
        tickTaille = 0.01;
      } else if (s.startsWith('FRX') || s.includes('EUR') || s.includes('GBP')) {
        tickVal = 100000;
        tickTaille = 0.0001;
      }
      const distanceTicks = Math.max(1, risque / tickTaille);
      const lotsEstimes = Math.max(0.01, Math.min(50, Number((montantRisque / (distanceTicks * (tickVal * tickTaille))).toFixed(2))));
      lotTexte = `Taille conseillée : <b>${lotsEstimes} lot(s)</b> (risque ${risquePct}% = $${montantRisque.toFixed(1)} sur $${capital})`;
    }
  } catch { /* si indisponible on omet */ }

  const lignes = [
    `<b>${sens} confirmé — ${m.symbol} ${m.tf}</b>${pct}`,
    '',
    entree !== null ? `Entrée : <b>${prixTxt(entree)}</b>` : 'Entrée : <b>non chiffrée</b>',
    stop !== null ? `Invalidation : <b>${prixTxt(stop)}</b>${risque ? ` (risque ${risque.toFixed(risque < 1 ? 5 : 2)})` : ''}`
      : 'Invalidation : <b>non chiffrée</b>',
    tp1 !== null ? `Objectif 1 : <b>${prixTxt(tp1)}</b>${enR(tp1)}` : null,
    tp2 !== null ? `Objectif 2 : <b>${prixTxt(tp2)}</b>${enR(tp2)}` : null,
    lotTexte,
    Number.isFinite(qualite.rr) ? `Gain/risque : ${qualite.rr.toFixed(2)} pour 1` : null,
    nbRegles ? `Règles : ${(v.rules || []).map(r => r.name).filter(Boolean).join(' + ') || nbRegles + ' confirmée(s)'}` : null,
    qualite.confluence
      ? `Alignement : ${qualite.confluence.nbAlignes}/${qualite.confluence.detail.length} unités d'accord`
      : null
  ].filter(x => x !== null);

  // Les conditions vérifiées : c'est ce qui permet de juger le signal, pas
  // seulement de le recevoir.
  if (Array.isArray(v.checklist) && v.checklist.length) {
    const cochees = v.checklist.map(x => `${x.ok ? '✓' : '✗'} ${x.label || ''}`).join(' · ');
    lignes.push('', `<b>Conditions</b>\n${cochees}`.slice(0, 900));
  }
  // Le détail des règles (2 lignes max, tronquées) : la raison du signal.
  const details = (v.rules || []).filter(r => r && r.detail).slice(0, 3)
    .map(r => `• ${r.name} : ${String(r.detail).slice(0, 140)}`);
  if (details.length) lignes.push('', `<b>Pourquoi</b>\n${details.join('\n')}`);
  // Alignement, unité par unité.
  if (qualite.confluence && Array.isArray(qualite.confluence.detail)) {
    lignes.push('', qualite.confluence.detail
      .map(t => `${t.tf} : ${t.tendance || '?'} · ${t.status || '?'}${t.direction && t.direction !== 'NEUTRE' ? ' ' + t.direction : ''}`)
      .join('\n'));
  }

  lignes.push('', `<i>${new Date().toLocaleString('fr-FR', { timeZone: 'UTC' })} UTC</i>`);
  lignes.push('5trade — outil d\'analyse, pas un conseil en investissement.');

  let texte = lignes.join('\n') + blocContexte(qualite.multi) + blocSignaux(qualite.multi);
  if (texte.length > 3900) texte = texte.slice(0, 3900) + '\n… (tronqué)';
  return texte;
}

async function envoyerTelegram(c, v, m, qualite = {}) {
  const texte = messageTelegram(v, m, qualite);

  // Boutons interactifs optimisés sous le message Telegram
  const sigId = [m.symbol, v.direction, v.at || Date.now()].join(':').slice(0, 48);
  const reply_markup = {
    inline_keyboard: [
      [
        { text: '📝 Simuler au Journal (Paper)', callback_data: `trade:open:${sigId}` },
        { text: '🛡️ Stop Breakeven', callback_data: `trade:be:${sigId}` }
      ],
      [
        { text: '🎯 Sécuriser 50% (TP1)', callback_data: `trade:tp1:${sigId}` },
        { text: '❌ Clôturer Position', callback_data: `trade:close:${sigId}` }
      ],
      [
        { text: '📊 État du Compte & Risque', callback_data: 'account:status' }
      ]
    ]
  };

  const r = await fetchAvecReprise(`https://api.telegram.org/bot${c.telegramToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: c.telegramChat, text: texte, parse_mode: 'HTML',
      disable_web_page_preview: true, reply_markup })
  });
  if (!r.ok) {
    const corps = await r.text().catch(() => '');
    throw new Error(`Telegram ${r.status}${corps ? ' : ' + corps.slice(0, 120) : ''}`);
  }
  return true;
}

function compose(v, m, prix, qualite = {}) {
  const sens = v.direction === 'BUY' ? 'ACHAT' : 'VENTE';
  const couleur = v.direction === 'BUY' ? '#10b981' : '#f2545b';
  const L = v.levels || {};
  const ligne = (k, val) => (val === null || val === undefined ? '' :
    `<tr><td style="padding:3px 10px 3px 0;color:#94a3b8">${k}</td><td style="padding:3px 0"><b>${val}</b></td></tr>`);

  return {
    subject: `[5trade] ${sens} confirmé — ${m.symbol} ${m.tf} (force ${Math.round(v.strength * 100)} %)`,
    html: `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#b1017;color:#e2e8f0;padding:22px;border-radius:12px;max-width:560px">
  <div style="font-size:13px;color:#94a3b8;letter-spacing:.4px">5trade — alerte de signal</div>
  <h2 style="margin:10px 0 4px;color:${couleur}">${sens} CONFIRMÉ</h2>
  <div style="color:#94a3b8;font-size:13.5px">${m.symbol} · ${m.tf} · ${v.strength ? Math.round(v.strength * 100) : '?'} % de force
    · ${v.confirmations} règle(s)</div>

  <table style="margin:16px 0;font-size:13.5px;border-collapse:collapse">
    ${ligne('Prix au signal', v.price || prix)}
    ${ligne('Entrée', L.entry)}
    ${ligne('Invalidation', L.stop)}
    ${ligne('Objectif 1', L.target1)}
    ${ligne('Objectif 2', L.target2)}
    ${ligne('Gain / risque', Number.isFinite(qualite.rr) ? `${qualite.rr.toFixed(2)} pour 1` : null)}
  </table>

  ${qualite.confluence ? `
  <div style="font-size:13px;color:#cbd5e1;margin-bottom:6px"><b>Alignement des unités de temps</b>
    <span style="color:#34d399">— ${qualite.confluence.nbAlignes}/${qualite.confluence.detail.length} d'accord</span></div>
  <table style="margin:0 0 14px;font-size:12.5px;border-collapse:collapse">
    ${qualite.confluence.detail.map(t => `<tr>
      <td style="padding:2px 10px 2px 0;color:#94a3b8">${t.tf}</td>
      <td style="padding:2px 10px 2px 0">${t.tendance}</td>
      <td style="padding:2px 0;color:#cbd5e1">${t.status}${t.direction && t.direction !== 'NEUTRE' ? ' · ' + t.direction : ''}</td>
    </tr>`).join('')}
  </table>` : ''}

  <div style="font-size:13px;color:#cbd5e1;margin-bottom:6px"><b>Règles déclenchées</b></div>
  <ul style="margin:0 0 14px 18px;padding:0;font-size:13px;color:#cbd5e1">
    ${(v.rules || []).map(r => `<li>${r.name} — ${r.detail}</li>`).join('') || '<li>—</li>'}
  </ul>

  <div style="font-size:13px;color:#cbd5e1;margin-bottom:6px"><b>Conditions</b></div>
  <div style="font-size:12.5px;color:#94a3b8">
    ${(v.checklist || []).map(c => `${c.ok ? '✓' : '✗'} ${c.label}`).join(' · ')}
  </div>

  ${(() => {
    // Liste des signaux : un même graphique peut en porter plusieurs, chacun
    // avec sa stratégie ou son motif. Les fondre en un seul effacerait
    // l'information que le trader a demandé à recevoir.
    const m2 = qualite.multi;
    if (!m2 || !Array.isArray(m2.signaux)) return '';
    const retenus = m2.signaux.filter(s => s.status === 'confirme' || s.status === 'surveiller');
    if (!retenus.length) {
      return `<div style="font-size:12.5px;color:#94a3b8;margin-top:12px">Aucun signal retenu sur ${m2.signaux.length} concept(s) évalué(s).</div>`;
    }
    const lignes = retenus.slice(0, 12).map(s => {
      const src = s.source === 'strategie' ? (s.strategie || s.nom) : s.nom;
      const sens = s.sens === 'long' ? 'achat' : s.sens === 'short' ? 'vente' : 'neutre';
      const couleur2 = s.sens === 'long' ? '#34d399' : s.sens === 'short' ? '#f2545b' : '#94a3b8';
      return `<li><b>${src}</b> — <span style="color:${couleur2}">${sens}</span>`
        + `${s.status === 'confirme' ? '' : ' (à surveiller)'} · force ${Math.round((s.force || 0) * 100)} %`
        + `${s.entree != null ? ` · entrée ${s.entree} / inv. ${s.stop}` : ''}</li>`;
    }).join('');
    return `<div style="font-size:13px;color:#cbd5e1;margin:14px 0 6px"><b>Signaux détectés (${retenus.length})</b></div>
  <ul style="margin:0 0 12px 18px;padding:0;font-size:12.5px;color:#cbd5e1">${lignes}</ul>`;
  })()}

  <div style="margin-top:16px;padding-top:12px;border-top:1px solid #1e293b;font-size:12px;color:#64748b">
    Bougie de déclenchement : ${new Date(v.at).toISOString().replace('T', ' ').slice(0, 16)} UTC<br>
    Vérifie le graphique avant d'agir : cette alerte signale une configuration, pas un ordre.
  </div>
</div>`
  };
}

// ── Verrou de cycle ──
// setInterval ne regarde pas si le tour precedent est fini. Avec 13 marches et des
// appels reseau, un cycle peut depasser l'intervalle : deux tours simultanes
// envoient deux fois la meme alerte et se disputent la base. Un seul tour a la fois.
let cycleEnCours = false;
// Dernier cycle : duree et nombre de chevauchements ignores (visible dans /healthz).
let dernierCycle = { debut: null, fin: null, dureeMs: null, chevauchements: 0 };
const etatCycle = () => ({ enCours: cycleEnCours, ...dernierCycle });

/** Verifie s'il y a lieu, en refusant de superposer deux tours. */
async function verifier(force = false) {
  if (cycleEnCours) {
    dernierCycle.chevauchements++;
    return { controle: false, raison: 'cycle precedent encore en cours : tour ignore' };
  }
  cycleEnCours = true;
  const debut = Date.now();
  try {
    return await verifierBrut(force);
  } finally {
    cycleEnCours = false;
    dernierCycle = { debut, fin: Date.now(), dureeMs: Date.now() - debut, chevauchements: dernierCycle.chevauchements };
  }
}

/** Un tour de verification. Separe de la boucle pour etre testable directement. */
async function verifierBrut(force = false) {
  // Pas d'exception ici : un contrôle demandé avant le démarrage de la
  // surveillance doit répondre « rien à faire », pas casser l'appelant.
  if (!deps) return { controle: false, raison: 'surveillance non démarrée' };
  const c = config;
  if (!force && !c.actif) return { controle: false, raison: 'alertes désactivées' };
  // Sans email, le push peut prendre le relais (sinon rien ne peut partir).
  if (!c.email && typeof deps.sendPush !== 'function') {
    return { controle: false, raison: 'aucun destinataire' };
  }
  if (!c.marches || !c.marches.length) return { controle: false, raison: 'aucun marché surveillé' };

  const resultats = [];
  // Mode d'analyse du cycle : 'stratégie' (règles de la stratégie sélectionnée)
  // ou 'générique' (aucune stratégie — on l'assume et on le dit).
  let modeAnalyse = 'stratégie';
  let envoyes = 0;

  // Aucun marche surveille : il n'y a RIEN a controler. Repondre « controle
  // effectue » laisserait croire que la surveillance tourne alors qu'elle ne
  // regarde rien — c'est exactement le cas ou le bot etait « branche sur du vide ».
  if (!c.marches || !c.marches.length) {
    return { controle: false, envoyes: 0, marches: [], raison: 'aucun marché surveillé' };
  }

  for (const m of c.marches) {
    try {
      // Indice synthétique = générateur aléatoire cryptographique. Aucun avantage
      // n'y est possible par construction : alerter dessus revient à alerter sur
      // un tirage au sort. On refuse, et on le dit dans le résultat du tour.
      if (require('../core/instruments').synthetique(m.symbol)) {
        resultats.push({ ...m, verdict: 'indice synthétique (RNG) : aucun avantage possible — non surveillé' });
        continue;
      }
      const r = await deps.market.getCandles(m.symbol, m.tf, 300, m.provider);
      const closes = (r.candles || []).filter(x => x.closed !== false);
      if (closes.length < 20) {
        resultats.push({ ...m, verdict: 'données insuffisantes' });
        continue;
      }

      // ── Fraîcheur ──
      // Un moteur ne doit jamais analyser silencieusement des prix périmés :
      // marché fermé, flux coupé, cache figé. On refuse, en disant l'âge.
      const frais = deps.signals.fraicheur ? deps.signals.fraicheur(closes, m.tf) : { ok: true };
      if (!frais.ok) {
        resultats.push({ ...m, verdict: frais.raison || 'fraîcheur des données non vérifiable' });
        continue;
      }

      // ── Qualité des données ──
      // La fraîcheur ne dit rien des trous, doublons, prix incohérents ni bougies
      // aberrantes : ces défauts faussent le calcul sans jamais lever d'erreur.
      let qualite = null;
      if (deps.qualite && typeof deps.qualite.analyser === 'function') {
        qualite = deps.qualite.analyser(closes, { timeframe: m.tf });
        if (!qualite.ok) {
          const graves = qualite.problemes.filter(p => p.gravite === 'critique').map(p => p.detail);
          resultats.push({ ...m, verdict: `données non fiables — ${graves.join(' ; ')}`, qualite });
          continue;
        }
      }
      // ── Le verdict est rendu SELON LA STRATÉGIE SÉLECTIONNÉE ──
      // Avant, detect() était appelé sans options : le go/no-go reposait donc sur
      // toutes les règles génériques, quelle que soit la stratégie cochée. La
      // stratégie ne changeait que le texte du message — exactement l'illusion
      // qu'il fallait supprimer.
      const profils = (typeof deps.profilsSurveillance === 'function')
        ? (await deps.profilsSurveillance().catch(() => [])) : [];
      const profilsValides = (profils || []).filter(p => p && p.executable !== false);
      const profilsInexecutables = (profils || []).filter(p => p && p.executable === false);

      if (!profils.length) {
        // Aucune stratégie : mode auto assumé, règles génériques, message honnête.
        // Aucune stratégie : mode auto assumé, règles génériques. On ne pousse
        // PAS d'entrée de résultat ici (elle ferait doublon avec celle du signal
        // et fausserait le décompte des envois) : on le dit dans le mode.
        modeAnalyse = 'générique (aucune stratégie sélectionnée)';
      } else if (!profilsValides.length) {
        // Toutes les stratégies cochées sont documentaires : on refuse plutôt que
        // de produire un signal générique sous un nom de stratégie.
        resultats.push({ ...m, verdict: `signal refusé — stratégie(s) non exécutable(s) : ${
          profilsInexecutables.map(p => p.titre || p.id).join(', ')}` });
        continue;
      }

      // Verdict du moteur, restreint aux règles de CHAQUE stratégie cochée.
      // Avant, seule la première était évaluée : cocher trois stratégies n'en
      // faisait tourner qu'une, en silence. Chaque fiche rend désormais son
      // propre verdict et son propre signal, tracés sous son nom.
      // Aucune stratégie cochée = mode générique : on évalue UNE fois sans fiche.
      const cibles = profilsValides.length ? profilsValides : [null];
      for (const profil of cibles) {
        // Tout verdict de cette passe porte le nom de la fiche : à l'écran, on doit
        // pouvoir dire « c'est SMC/ICT qui a refusé », pas un « neutre » anonyme.
        const etiquette = profil ? (profil.titre || profil.id) : null;
        const dire = (obj) => resultats.push({ ...m, strategie: etiquette, ...obj });
      const optionsMoteur = profil ? {
        regles: profil.regles,
        obligatoires: profil.obligatoires || [],
        seuilForce: profil.seuilForce,
        seuilRegles: profil.seuilRegles,
        parametres: profil.parametres,
        strategie: { id: profil.id, titre: profil.titre },
        strict: true
      } : {};
      const v = deps.signals.detect(closes, { symbol: m.symbol, timeframe: m.tf }, optionsMoteur);

      // ── Traçabilité : conditions NOMMÉES + preuve ──
      // Le journal ne gardait que des compteurs (5/7). On enregistre ici le nom de
      // chaque condition, si elle était obligatoire, si elle est remplie et ce
      // qu'elle valait. C'est la réponse à « pourquoi ce signal ? ».
      let traceEvaluation = null;
      if (deps.preuves && typeof deps.preuves.enregistrerEvaluation === 'function') {
        const statutTrace = v.status === 'refuse' ? 'INVALID'
          : v.status === 'confirme' ? 'VALID'
            : (v.reglesActives && v.reglesActives.length ? 'WAITING' : 'NO_DATA');
        try {
          traceEvaluation = await deps.preuves.enregistrerEvaluation({
            strategieId: (profil && profil.id) || 'generique',
            version: profil && profil.version,
            fiche: profil ? { id: profil.id, titre: profil.titre, regles: profil.regles } : undefined,
            symbole: m.symbol,
            timeframe: m.tf,
            regime: null,
            statut: statutTrace,
            // Jamais null : l'absence de direction est UNKNOWN, pas un vide.
            direction: (() => {
              const d = String(v.direction || '').toUpperCase();
              if (d === 'BUY' || d === 'ACHAT' || d === 'LONG') return 'BUY';
              if (d === 'SELL' || d === 'VENTE' || d === 'SHORT') return 'SELL';
              if (d === 'NEUTRAL' || d === 'NEUTRE') return 'NEUTRAL';
              return 'UNKNOWN';
            })(),
            conditions: Object.fromEntries((v.reglesActives || []).map(r => [r, true])),
            manquantes: v.bloquantes || [],
            score: v.strength,
            preuves: deps.preuves.preuvesDepuisVerdict(v)
          });
        } catch { traceEvaluation = null; }
      }

      // ── DECISION ENGINE : arbitrage central (remplace verdict unique + multi-signaux) ──
      let decision = null;
      // `multi` doit vivre pendant TOUT le tour de boucle : la clé anti-doublon,
      // la composition du message et l'envoi Telegram le lisent bien plus bas.
      // Déclaré dans le seul bloc de repli, il provoquait « multi is not defined »
      // dès que le Decision Engine répondait — donc en production, à chaque cycle.
      let multi = null;
      // Alignement multi-unités : la décision l'EXIGE (c.exigerAlignement) mais ne
      // peut pas le calculer — elle ne reçoit qu'une série. Sans cette fourniture,
      // le contrôle restait inopérant et la surveillance confirmait sans lui.
      let confluenceSurveillance = null;
      if (typeof deps.alignementMtf === 'function') {
        try {
          const al = await deps.alignementMtf(m.symbol, m.tf, m.provider);
          confluenceSurveillance = (al && al.confluence) || null;
        } catch { /* une unité indisponible ne bloque pas la surveillance */ }
      }
      // Garde-fou de COMPTE : un refus de risque doit empêcher l'alerte, exactement
      // comme il empêche la décision. Le serveur fournit la fabrique — lui seul
      // connaît le journal, donc l'état réel du compte.
      let verificateurRisque;
      if (typeof deps.verificateurRisque === 'function') {
        try { verificateurRisque = deps.verificateurRisque(); } catch { verificateurRisque = undefined; }
      }
      if (deps.DecisionEngine && typeof deps.DecisionEngine.decider === 'function') {
        try {
          decision = deps.DecisionEngine.decider(closes, { symbol: m.symbol, timeframe: m.tf }, {
            // UNE stratégie par passage. Avant, la boucle parcourait les fiches
            // mais transmettait la liste COMPLÈTE : avec trois stratégies, trois
            // passages réévaluaient les trois, et le signal retenu pouvait
            // appartenir à une autre fiche que celle qui signait l'alerte.
            profils: profil ? [profil] : undefined,
            rrMin: c.rrMin,
            exigerAlignement: c.exigerAlignement,
            refuserDesaccord: c.refuserDesaccord,
            refuserContreTendance: c.refuserContreTendance,
            verifierFrais: process.env.FRAIS_STRICT === '0' ? true : 'strict',
            verifierModele: true,
            confluence: confluenceSurveillance,
            verificateurRisque,
            exigerVerificateurRisque: true
          });
        } catch { decision = null; }
      }
      // Fallback : si DecisionEngine indisponible, on garde l'ancien chemin (v + multi)
      if (!decision) {
        if (deps.signaux && typeof deps.signaux.detecterTout === 'function') {
          try {
            multi = deps.signaux.detecterTout(closes, { symbol: m.symbol, timeframe: m.tf }, { profils });
          } catch { multi = null; }
        }
        // Le journal est écrit PLUS BAS, après tous les filtres. Il l'était ici,
        // donc AVANT le filtre économique, la force minimale, le désaccord,
        // l'alignement MTF et le RR : une position qu'on n'annonçait jamais
        // restait ouverte au journal, consommait un slot de `maxSimultanes` et
        // faussait l'état du compte pour les prises suivantes.

        // Le repli ne passe pas par le niveau de risque : il ne peut donc pas
        // produire d'alerte exécutable. Avant, un signal refusé par le journal
        // (plafonds du compte) partait quand même par ce chemin.
        dire({ verdict: `moteur de décision indisponible — repli informatif : ${v.status}`,
               secours: true });
        continue;
      } else {
        // Decision Engine a produit un verdict : on l'utilise pour l'alerte
        if (decision.decision !== 'ACHAT' && decision.decision !== 'VENTE') {
          dire({ verdict: `décision : ${decision.decision} — ${decision.raison}` });
          continue;
        }

        // GARDE-FOU P0 : une alerte exécutable NE DOIT PAS continuer sans validation explicite du risque
        if (!decision.risque || decision.risque.ok !== true) {
          dire({ verdict: `alerte suspendue — risque non validé (${(decision.risque && decision.risque.refus && decision.risque.refus.join(', ')) || decision.risque?.motif || 'autorisation non explicite'})` });
          continue;
        }

        // Aucun signal ne doit être publié sans executable === true
        const signauxExec = (decision.signauxRetenus || []).filter(x => x.executable === true);
        if (!signauxExec.length) {
          dire({ verdict: 'alerte suspendue — aucun signal retenu portant executable === true' });
          continue;
        }
        // Meilleur signal retenu par l'arbitrage = celui qu'on alerte
        const s = decision.signal;
        // Un motif publie `entree/stop/objectifs`, une fiche publie
        // `levels.entry/stop`. Exiger la seconde forme faisait refuser toute
        // alerte gagnée par un motif — alors que ses niveaux existaient.
        const lvS = (s && s.levels) || {};
        const entreeS = Number(lvS.entry !== undefined ? lvS.entry : s && s.entree);
        const stopS = Number(lvS.stop !== undefined ? lvS.stop : s && s.stop);
        if (!s || !Number.isFinite(entreeS) || !Number.isFinite(stopS)) {
          dire({ verdict: 'décision sans niveaux exploitables : ni levels.entry/stop, ni entree/stop' });
          continue;
        }
        s.levels = { ...lvS, entry: entreeS, stop: stopS,
          objectifs: lvS.objectifs || (s && s.objectifs) || [] };
        // On utilise ce signal pour le reste de la logique (filtres, RR, envoi)
        // On adapte les variables attendues par le code existant
        v.direction = s.sens === 'long' ? 'BUY' : 'SELL';
        v.strength = s.force;
        v.levels = s.levels;
        v.price = decision.price;
        v.summary = decision.raison;
        v.at = decision.at;
      }

      // ── Filtre économique ──
      // Il n'était appliqué QUE sur le chemin IA, jamais ici : une alerte pouvait
      // donc partir pendant une publication NFP. Et quand le calendrier est
      // injoignable, on le dit au lieu de laisser croire que tout est vérifié.
      let fondamental = null;
      if (typeof deps.filtreNews === 'function') {
        try {
          fondamental = await deps.filtreNews(m.symbol);
        } catch (e) {
          // Trois états distincts : BLOQUÉ, CLAIR, INCONNU. Un calendrier
          // injoignable n'est pas un calendrier vérifié — avant, l'erreur
          // ressortait avec `ok: true` et seule la clé `bloque` était testée,
          // donc l'alerte partait sans vérification économique.
          fondamental = { ok: false, verifie: false, statut: 'NEWS_UNKNOWN',
            lecture: `calendrier indisponible (${e.message}) : vérification économique impossible` };
        }
        if (fondamental && fondamental.bloque) {
          dire({ verdict: `signal bloqué — ${fondamental.lecture}`, fondamental });
          continue;
        }
        // Par défaut, une vérification impossible BLOQUE : on ne prend pas une
        // position sur un marché macro sans savoir ce qui est publié.
        if (fondamental && fondamental.statut === 'NEWS_UNKNOWN' && c.accepterNewsNonVerifiee !== true) {
          dire({ verdict: `signal bloqué — ${fondamental.lecture} (accepterNewsNonVerifiee pour passer outre)`, fondamental });
          continue;
        }
      }
      if (v.strength < c.forceMin) {
        dire({ verdict: `confirmé mais force ${Number(v.strength).toFixed(2)}/1 (${v.forceNiveau || '—'}) < seuil` });
        continue;
      }

      // ── Garde-fous : on ne réveille personne pour un signal douteux ──
      // 1. Règles en désaccord franc : deux règles opposées ne sont pas un signal.
      if (c.refuserDesaccord && v.contradiction && v.contradiction.franche) {
        dire({ verdict: `refusé — ${v.contradiction.lecture}` });
        continue;
      }

      // 2. Alignement des unités de temps : le contexte doit confirmer.
      let confluence = null;
      if (c.exigerAlignement) {
        // La stratégie peut imposer SES unités (M5 + M1, ou H4 + H1 + M15). On
        // les utilise telles quelles ; sinon on retombe sur la hiérarchie standard.
        // Avant, une stratégie M5/M1 était jugée sur les unités supérieures du
        // symbole, jamais sur celles qu'elle demandait.
        // Une stratégie peut déclarer 1, 2 ou 3 unités — et sous deux formes : un
        // tableau, ou un objet par rôle {context, confirmation, execution}. Avant,
        // seule la forme tableau était lue : une fiche écrite par rôle voyait ses
        // unités IGNORÉES et se faisait juger sur la hiérarchie standard du
        // symbole. Une stratégie en 2 unités était donc évaluée sur d'autres.
        const declarees = (() => {
          const d = profil && profil.timeframes;
          if (Array.isArray(d)) return d.length ? d : null;
          if (d && typeof d === 'object') {
            const liste = ['context', 'confirmation', 'execution']
              .flatMap(role => (Array.isArray(d[role]) ? d[role] : []));
            return liste.length ? [...new Set(liste)] : null;
          }
          return null;
        })();
        const tfs = declarees || (deps.signals.TF_SUPERIEURS[m.tf] || [m.tf]);
        const parTF = [{ tf: m.tf, verdict: v }];
        // Séries conservées pour vérifier la synchronisation temporelle des unités.
        const series = [{ timeframe: m.tf, bougies: closes }];
        const indisponibles = [];
        for (const t of tfs) {
          if (t === m.tf) continue;
          try {
            const r2 = await deps.market.getCandles(m.symbol, t, 300, m.provider);
            const cl2 = (r2.candles || []).filter(x => x.closed !== false);
            if (cl2.length >= 20) {
              // MÊME profil, même seuils : la confluence ne doit pas juger avec
              // des règles que la stratégie n'a pas demandées.
              parTF.push({ tf: t, verdict: deps.signals.detect(cl2, { symbol: m.symbol, timeframe: t }, optionsMoteur) });
              series.push({ timeframe: t, bougies: cl2 });
            } else {
              indisponibles.push(`${t} (${cl2.length} bougie(s))`);
            }
          } catch (e) {
            indisponibles.push(`${t} (indisponible)`);
          }
        }
        // Une unité exigée par la stratégie et absente est une condition
        // obligatoire manquante : aucun signal, et on dit laquelle.
        if (declarees && indisponibles.length) {
          dire({
            verdict: `signal refusé — unité(s) de temps obligatoire(s) indisponible(s) : ${indisponibles.join(', ')}` });
          continue;
        }
        // Un H1 figé depuis trois heures ne confirme rien sur un M5 : la
        // synchronisation est vérifiée avant d'utiliser la confluence.
        if (deps.qualite && typeof deps.qualite.synchroniser === 'function' && series.length > 1) {
          const sync = deps.qualite.synchroniser(series);
          if (!sync.aligne) {
            dire({ verdict: 'unités de temps désynchronisées — ' + sync.raison, sync });
            continue;
          }
        }
        // Le seuil d'alignement doit rester compatible avec ce que la stratégie
        // déclare : exiger 2 unités alignées sur une stratégie qui n'en déclare
        // qu'une la refusait systématiquement. Quand la stratégie déclare ses
        // unités, ce sont ses conditions : elles doivent toutes s'aligner — 2
        // déclarées → 2 requises, 3 → 3, 4 → 4. Le seuil suit donc SON nombre
        // d'unités, sans plafond global, sauf valeur explicitement imposée par
        // la fiche (auquel cas elle fait foi, bornée aux unités disponibles).
        const seuilDemande = (profil && Number.isFinite(profil.seuilAlignes))
          ? profil.seuilAlignes : c.seuilAlignes;
        const seuilEffectif = declarees
          ? Math.min(
              Number.isFinite(profil && profil.seuilAlignes) ? profil.seuilAlignes : declarees.length,
              Math.max(1, parTF.length))
          : seuilDemande;
        confluence = deps.signals.confluence(parTF, { seuilAlignes: seuilEffectif });
        confluence.seuilDemande = seuilDemande;
        confluence.seuilApplique = seuilEffectif;
        confluence.unitesDeclarees = declarees || null;
        if (!confluence.aligne) {
          dire({ verdict: `refusé — alignement insuffisant (${confluence.motif})`, confluence });
          continue;
        }
        if (c.refuserContreTendance && confluence.contreTendance) {
          dire({ verdict: `refusé — contre-tendance (${confluence.motif})`, confluence });
          continue;
        }
      }

      // 3. Rapport gain/risque & Cohérence des niveaux : entrée, SL et objectifs dans le bon ordre
      let rr = null;
      const lv = v.levels || {};
      const aEntree = Number.isFinite(lv.entry);
      const aStop = Number.isFinite(lv.stop);
      const aTp1 = Number.isFinite(lv.target1);
      const aTp2 = Number.isFinite(lv.target2);

      if (aEntree && aStop && aTp1) {
        const distRisque = Math.abs(lv.entry - lv.stop);
        if (distRisque <= 0) {
          dire({ verdict: 'refusé — distance stop loss nulle' });
          continue;
        }
        // Vérification de l'ordre géométrique selon le sens du signal
        const estAchat = v.direction === 'BUY' || v.direction === 'ACHAT';
        const estVente = v.direction === 'SELL' || v.direction === 'VENTE';
        if (estAchat) {
          if (lv.stop >= lv.entry) {
            dire({ verdict: `refusé — ordre des niveaux invalide à l'achat : stop (${lv.stop}) >= entrée (${lv.entry})` });
            continue;
          }
          if (lv.target1 <= lv.entry) {
            dire({ verdict: `refusé — ordre des niveaux invalide à l'achat : TP1 (${lv.target1}) <= entrée (${lv.entry})` });
            continue;
          }
          if (aTp2 && lv.target2 <= lv.target1) {
            dire({ verdict: `refusé — ordre des niveaux invalide à l'achat : TP2 (${lv.target2}) <= TP1 (${lv.target1})` });
            continue;
          }
        } else if (estVente) {
          if (lv.stop <= lv.entry) {
            dire({ verdict: `refusé — ordre des niveaux invalide à la vente : stop (${lv.stop}) <= entrée (${lv.entry})` });
            continue;
          }
          if (lv.target1 >= lv.entry) {
            dire({ verdict: `refusé — ordre des niveaux invalide à la vente : TP1 (${lv.target1}) >= entrée (${lv.entry})` });
            continue;
          }
          if (aTp2 && lv.target2 >= lv.target1) {
            dire({ verdict: `refusé — ordre des niveaux invalide à la vente : TP2 (${lv.target2}) >= TP1 (${lv.target1})` });
            continue;
          }
        }
        // Calcul systématique du RR après validation des niveaux
        rr = +(Math.abs(lv.target1 - lv.entry) / distRisque).toFixed(2);
        if (c.rrMin > 0 && rr < c.rrMin) {
          dire({ verdict: `refusé — gain/risque ${rr.toFixed(2)} < ${c.rrMin}` });
          continue;
        }
      }

      // La clé d'anti-doublon inclut l'ENSEMBLE des signaux confirmés : un motif
      // qui apparaît en plus (marteau, double bottom) est une information
      // nouvelle, elle mérite une alerte. Sans suffixe (aucun multi-signal), la
      // clé reste IDENTIQUE à l'ancienne forme — on ne casse pas le dédoublonnage.
      const sigKey = multi
        ? multi.signaux.filter(s => s.status === 'confirme').map(s => s.id).sort().join('+')
        : '';
      const cleBase = `${m.provider}|${m.symbol}|${m.tf}|${v.direction}|${v.at}`
        + (profil ? `|${profil.id}` : '');
      const cle = sigKey ? `${cleBase}|${sigKey}` : cleBase;
      // Dédoublonnage : un signal identique déjà parti ne repart pas. Le cooldown
      // est ce qui distingue « ce setup a déjà été signalé » de « il y a deux
      // minutes » : sans lui, un marché calme renvoie la même alerte à chaque cycle.
      const cooldownMs = (Number.isFinite(c.cooldownMin) ? c.cooldownMin : 30) * 60_000;
      const vuA = c.dejaAt && Number.isFinite(c.dejaAt[cle]) ? c.dejaAt[cle] : null;
      if (!cooldownMs && c.deja.includes(cle)) {
        dire({ verdict: 'déjà alerté' });
        continue;
      }
      if (cooldownMs && vuA !== null && Date.now() - vuA < cooldownMs) {
        dire({ verdict: 'déjà alerté (cooldown)' });
        continue;
      }

      // ── JOURNAL — APRÈS TOUS LES FILTRES, POUR LES DEUX CHEMINS ────────
      // Écrit ici et pas plus haut : le signal a passé le filtre économique, la
      // force minimale, le désaccord, l'alignement MTF, le RR et le cooldown.
      // Avant, le chemin de repli enregistrait la position AVANT ces filtres —
      // une position jamais annoncée restait ouverte au journal, consommait un
      // slot de `maxSimultanes` et faussait `Risque.verifierPrise` au cycle suivant.
      if (deps.journal && typeof deps.journal.enregistrer === 'function') {
        // On enregistre les signaux RETENUS par l'arbitrage, pas ceux qui
        // portaient « confirme » avant les filtres. Un signal rejeté à la
        // confirmation ou par les frais pouvait entrer au journal comme
        // position ouverte, consommer un slot et fausser le risque suivant.
        // Ceux en observation (surveiller) restent hors des positions ouvertes.
        const retenus = decision && Array.isArray(decision.signauxRetenus)
          ? decision.signauxRetenus.filter(x => x.executable === true)
          : ((multi ? multi.signaux : []) || []).filter(x => x.status === 'confirme');
        if (retenus.length) {
          try {
            deps.journal.enregistrer(retenus, {
              symbol: m.symbol, timeframe: m.tf, provider: m.provider, at: v.at
            });
          } catch { /* le journal ne doit jamais bloquer une alerte */ }
        }
      }

      const msg = compose(v, m, r.candles[r.candles.length - 1].c, { confluence: decision?.confluence, rr: rr, multi: decision ? { signaux: decision.signaux, synthese: decision.synthese, carte: decision.carte } : multi });
      let emailOk = false;
      if (c.email) {
        await deps.sendMail({ to: c.email, subject: msg.subject, html: msg.html });
        emailOk = true;
      }
      // Push navigateur : un canal en panne ne bloque jamais l'autre.
      let pushOk = 0;
      if (typeof deps.sendPush === 'function') {
        try {
          pushOk = await deps.sendPush(payloadSignal({
            direction: v.direction, status: v.status, symbol: m.symbol,
            strength: v.strength, levels: v.levels, id: cle
          })) || 0;
        } catch { /* le mail déjà parti reste valide */ }
      }
      const aUnCanal = !!c.email || pushOk > 0 || !!(c.telegramToken && c.telegramChat);
      if (!aUnCanal) {
        dire({ verdict: 'aucun canal disponible' });
        continue;
      }
      // Telegram : priorité directe sur téléphone
      if (c.telegramToken && c.telegramChat) {
        try { await envoyerTelegram(c, v, m, { confluence, rr, multi }); }
        catch (e) { dire({ verdict: 'alerte envoyée, Telegram en échec : ' + e.message }); }
      }
      c.deja.push(cle);
      c.dejaAt = { ...(c.dejaAt || {}), [cle]: Date.now() };
      envoyes++;
      // Signal publié : rattaché à son évaluation, avec ses niveaux. Sans ce lien,
      // la table signals serait orpheline et la question « pourquoi ce signal ? »
      // resterait sans réponse.
      if (traceEvaluation && traceEvaluation.ok && deps.preuves
        && typeof deps.preuves.enregistrerSignal === 'function') {
        try {
          await deps.preuves.enregistrerSignal({
            evaluationId: traceEvaluation.id,
            strategieId: (profil && profil.id) || 'generique',
            version: (profil && profil.version) || undefined,
            symbole: m.symbol, timeframe: m.tf,
            direction: v.direction,
            entree: v.levels ? v.levels.entry : null,
            stop: v.levels ? v.levels.stop : null,
            objectifs: v.levels ? [v.levels.target1, v.levels.target2].filter(Number.isFinite) : [],
            // `rr` est celui calculé et contrôlé plus haut (le niveau ne le porte pas).
            rr: Number.isFinite(rr) ? rr : null
          });
        } catch { /* la trace ne doit jamais empêcher l'alerte */ }
      }
      c.derniers.unshift({
        at: Date.now(), symbol: m.symbol, tf: m.tf, provider: m.provider,
        providerLabel: deps.labelOf ? deps.labelOf(m.provider) : m.provider,
        direction: v.direction, strength: v.strength, status: v.status,
        prix: v.price, entry: v.levels ? v.levels.entry : null,
        sl: v.levels ? v.levels.stop : null, tp: v.levels ? v.levels.target1 : null,
        summary: v.summary, cle
      });
      resultats.push({ ...m, verdict: 'ALERTE ENVOYÉE', force: v.strength, strategie: profil ? (profil.titre || profil.id) : null });
      }
    } catch (e) {
      // Un marché en échec ne doit jamais empêcher les autres d'être surveillés.
      resultats.push({ ...m, verdict: 'erreur', detail: e.message });
    }
  }

  if (envoyes) {
    config.deja = config.deja.slice(-200);
    const gardees = new Set(config.deja);
    config.dejaAt = Object.fromEntries(
      Object.entries(config.dejaAt || {}).filter(([k]) => gardees.has(k)));
    config.derniers = config.derniers.slice(0, 50);
    save();
  }
  return { controle: true, envoyes, marches: resultats };
}

/** Démarre la surveillance périodique (idempotent). */
function start(injections) {
  if (injections) deps = injections;
  if (timer) clearInterval(timer);
  const ms = Math.max(15, config.intervalleSec) * 1000;
  timer = setInterval(() => { verifier().catch(() => {}); }, ms);
  if (timer.unref) timer.unref();     // ne retient pas le process en vie
  return { intervalleSec: config.intervalleSec, actif: config.actif, marches: config.marches.length };
}

function stop() { if (timer) { clearInterval(timer); timer = null; } }

/** Abonnements push navigateur (persistés dans alerts.json avec le reste). */
function listerAbonnements() {
  return Array.isArray(config.abonnements) ? config.abonnements : [];
}

function ajouterAbonnement(sub) {
  if (!sub || !sub.endpoint) throw new Error('Abonnement invalide');
  const liste = listerAbonnements().filter(s => s.endpoint !== sub.endpoint);
  liste.push({ endpoint: String(sub.endpoint).slice(0, 500), keys: sub.keys || {}, at: Date.now() });
  config.abonnements = liste.slice(-20);
  save();
  return config.abonnements;
}

function retirerAbonnement(endpoint) {
  config.abonnements = listerAbonnements().filter(s => s.endpoint !== endpoint);
  save();
  return config.abonnements;
}

module.exports = {
  etatCycle,
  load, save, get, update, resetDedup, verifier, start, stop, compose, messageTelegram, DEFAUT,
  hydrater, diagnostic,
  listerAbonnements, ajouterAbonnement, retirerAbonnement
};
