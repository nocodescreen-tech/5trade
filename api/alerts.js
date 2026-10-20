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
const { fetchAvecReprise } = require('./reseau');
// Constructeur de payload push pur (aucun effet de bord) : l'envoi passe
// par deps.sendPush injecté, comme sendMail.
const { payloadSignal } = require('./pushAlerts');

const DATA_DIR = path.join(__dirname, '..', 'data');
// Le fichier de configuration est surchargeable par l'environnement.
// POURQUOI : la suite de tests faisait Al.update({ actif: false, email: null })
// sur le VRAI fichier — lancer le canonique effaçait donc la configuration de
// l'utilisateur (surveillance éteinte, email vidé, marchés remplacés par un
// marché de test). Les tests écrivent désormais dans un fichier à part.
const FICHIER = process.env.ALERTS_FICHIER || path.join(DATA_DIR, 'alerts.json');

/** Configuration par défaut : surveillance inactive tant qu'aucun email n'est posé. */
const DEFAUT = {
  actif: false,
  email: null,               // destinataire (par défaut : l'email du compte)
  forceMin: 0.5,             // n'alerter qu'au-delà de cette force
  intervalleSec: 60,         // fréquence de contrôle
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
  abonnements: []            // abonnements push navigateur [{ endpoint, keys, at }]
};

let config = { ...DEFAUT };
let deps = null;
let timer = null;

function load() {
  try {
    if (fs.existsSync(FICHIER)) {
      const disque = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
      config = { ...DEFAUT, ...disque };
    }
  } catch (e) {
    console.error('   Alertes    : configuration illisible —', e.message);
  }
  return config;
}

function save() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FICHIER, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('   Alertes    : enregistrement impossible —', e.message);
  }
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
 * et la force. Les non-remplis sont comptés, pas listés (le message resterait
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

async function envoyerTelegram(c, v, m, qualite = {}) {
  const L = v.levels || {};
  const sens = v.direction === 'BUY' ? 'ACHAT' : 'VENTE';
  const pct = v.strength ? ` · force ${Math.round(v.strength * 100)} %` : '';
  const al = qualite.confluence
    ? `\nAlignement : ${qualite.confluence.nbAlignes}/${qualite.confluence.detail.length} unités d'accord`
    : '';
  const rr = Number.isFinite(qualite.rr) ? `\nGain/risque : ${qualite.rr.toFixed(2)} pour 1` : '';
  const texte = [
    `<b>${sens} confirmé — ${m.symbol} ${m.tf}</b>${pct}`,
    `Entrée : ${L.entry ?? '—'}`,
    `Invalidation : ${L.stop ?? '—'}`,
    `Objectifs : ${L.target1 ?? '—'} puis ${L.target2 ?? '—'}`,
    `${(v.rules || []).map(r => r.name).join(' + ')}${al}${rr}`,
    '5trade — outil d\'analyse, pas un conseil en investissement.'
  ].join('\n') + blocContexte(qualite.multi) + blocSignaux(qualite.multi);

  const r = await fetchAvecReprise(`https://api.telegram.org/bot${c.telegramToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: c.telegramChat, text: texte, parse_mode: 'HTML',
      disable_web_page_preview: true })
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

/** Un tour de vérification. Séparé de la boucle pour être testable directement. */
async function verifier(force = false) {
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
  let envoyes = 0;

  // Aucun marche surveille : il n'y a RIEN a controler. Repondre « controle
  // effectue » laisserait croire que la surveillance tourne alors qu'elle ne
  // regarde rien — c'est exactement le cas ou le bot etait « branche sur du vide ».
  if (!c.marches || !c.marches.length) {
    return { controle: false, envoyes: 0, marches: [], raison: 'aucun marché surveillé' };
  }

  for (const m of c.marches) {
    try {
      const r = await deps.market.getCandles(m.symbol, m.tf, 300, m.provider);
      const closes = (r.candles || []).filter(x => x.closed !== false);
      if (closes.length < 20) {
        resultats.push({ ...m, verdict: 'données insuffisantes' });
        continue;
      }
      const v = deps.signals.detect(closes, { symbol: m.symbol, timeframe: m.tf });

      // ── Signaux MULTIPLES : la liste, pas un verdict seul ──
      // La surveillance n'utilisait AUCUNE stratégie de l'utilisateur : elle
      // appelait detect() sans options, donc en mode auto (toutes les règles).
      // On évalue ici chaque stratégie configurée séparément, plus les motifs,
      // pour que l'alerte dise QUELLE stratégie s'est déclenchée.
      let multi = null;
      if (deps.signaux && typeof deps.signaux.detecterTout === 'function') {
        try {
          const profils = typeof deps.profilsSurveillance === 'function'
            ? (await deps.profilsSurveillance()) : [];
          multi = deps.signaux.detecterTout(closes, { symbol: m.symbol, timeframe: m.tf },
            { profils });
        } catch { multi = null; }
      }

      // Le journal se remplit ICI aussi, pas seulement quand l'onglet « Direct »
      // est ouvert. Sans ça, un signal émis pendant que l'app est fermée
      // n'entrait jamais dans le journal : les statistiques ne décrivaient qu'une
      // partie de la réalité, et le backtest seul ne pouvait rien dire du live.
      // Le dédoublonnage par identité évite le doublon avec le flux.
      if (multi && deps.journal && typeof deps.journal.enregistrer === 'function') {
        try {
          deps.journal.enregistrer(
            multi.signaux.filter(x => x.status === 'confirme' || x.status === 'surveiller'),
            { symbol: m.symbol, timeframe: m.tf, provider: m.provider, at: v.at }
          );
        } catch { /* le journal ne doit jamais bloquer une alerte */ }
      }

      if (v.status !== 'confirme') { resultats.push({ ...m, verdict: v.status }); continue; }
      if (v.strength < c.forceMin) {
        resultats.push({ ...m, verdict: `confirmé mais force ${Number(v.strength).toFixed(2)}/1 (${v.forceNiveau || '—'}) < seuil` });
        continue;
      }

      // ── Garde-fous : on ne réveille personne pour un signal douteux ──
      // 1. Règles en désaccord franc : deux règles opposées ne sont pas un signal.
      if (c.refuserDesaccord && v.contradiction && v.contradiction.franche) {
        resultats.push({ ...m, verdict: `refusé — ${v.contradiction.lecture}` });
        continue;
      }

      // 2. Alignement des unités de temps : le contexte doit confirmer.
      let confluence = null;
      if (c.exigerAlignement) {
        const tfs = deps.signals.TF_SUPERIEURS[m.tf] || [m.tf];
        const parTF = [{ tf: m.tf, verdict: v }];
        for (const t of tfs) {
          if (t === m.tf) continue;
          try {
            const r2 = await deps.market.getCandles(m.symbol, t, 300, m.provider);
            const cl2 = (r2.candles || []).filter(x => x.closed !== false);
            if (cl2.length >= 20) {
              parTF.push({ tf: t, verdict: deps.signals.detect(cl2, { symbol: m.symbol, timeframe: t }) });
            }
          } catch (e) { /* une unité indisponible ne bloque pas les autres */ }
        }
        confluence = deps.signals.confluence(parTF, { seuilAlignes: c.seuilAlignes });
        if (!confluence.aligne) {
          resultats.push({ ...m, verdict: `refusé — alignement insuffisant (${confluence.motif})`, confluence });
          continue;
        }
        if (c.refuserContreTendance && confluence.contreTendance) {
          resultats.push({ ...m, verdict: `refusé — contre-tendance (${confluence.motif})`, confluence });
          continue;
        }
      }

      // 3. Rapport gain/risque : un signal dont l'objectif est plus proche que
      //    l'invalidation ne mérite pas d'être pris, donc pas d'être envoyé.
      let rr = null;
      const lv = v.levels || {};
      if (c.rrMin > 0 && Number.isFinite(lv.entry) && Number.isFinite(lv.stop)
        && Number.isFinite(lv.target1) && Math.abs(lv.entry - lv.stop) > 0) {
        rr = Math.abs(lv.target1 - lv.entry) / Math.abs(lv.entry - lv.stop);
        if (rr < c.rrMin) {
          resultats.push({ ...m, verdict: `refusé — gain/risque ${rr.toFixed(2)} < ${c.rrMin}` });
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
      const cleBase = `${m.provider}|${m.symbol}|${m.tf}|${v.direction}|${v.at}`;
      const cle = sigKey ? `${cleBase}|${sigKey}` : cleBase;
      if (c.deja.includes(cle)) { resultats.push({ ...m, verdict: 'déjà alerté' }); continue; }

      const msg = compose(v, m, r.candles[r.candles.length - 1].c, { confluence, rr, multi });
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
      if (!emailOk && pushOk <= 0) {
        resultats.push({ ...m, verdict: 'aucun canal disponible' });
        continue;
      }
      // Telegram en plus : l'email peut attendre, le telephone non. Un echec
      // Telegram ne remet pas en cause l'alerte email deja partie.
      if (c.telegramToken && c.telegramChat) {
        try { await envoyerTelegram(c, v, m, { confluence, rr, multi }); }
        catch (e) { resultats.push({ ...m, verdict: 'alerte envoyée, Telegram en échec : ' + e.message }); }
      }
      c.deja.push(cle);
      envoyes++;
      c.derniers.unshift({
        at: Date.now(), symbol: m.symbol, tf: m.tf, provider: m.provider,
        providerLabel: deps.labelOf ? deps.labelOf(m.provider) : m.provider,
        direction: v.direction, strength: v.strength, status: v.status,
        prix: v.price, entry: v.levels ? v.levels.entry : null,
        sl: v.levels ? v.levels.stop : null, tp: v.levels ? v.levels.target1 : null,
        summary: v.summary, cle
      });
      resultats.push({ ...m, verdict: 'ALERTE ENVOYÉE', force: v.strength });
    } catch (e) {
      // Un marché en échec ne doit jamais empêcher les autres d'être surveillés.
      resultats.push({ ...m, verdict: 'erreur', detail: e.message });
    }
  }

  if (envoyes) {
    config.deja = config.deja.slice(-200);
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
  load, save, get, update, resetDedup, verifier, start, stop, compose, DEFAUT,
  listerAbonnements, ajouterAbonnement, retirerAbonnement
};
