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

const DATA_DIR = path.join(__dirname, '..', 'data');
const FICHIER = path.join(DATA_DIR, 'alerts.json');

/** Configuration par défaut : surveillance inactive tant qu'aucun email n'est posé. */
const DEFAUT = {
  actif: false,
  email: null,               // destinataire (par défaut : l'email du compte)
  forceMin: 0.5,             // n'alerter qu'au-delà de cette force
  intervalleSec: 60,         // fréquence de contrôle
  marches: [
    { symbol: 'frxXAUUSD', tf: '15m', provider: 'deriv' },
    { symbol: 'R_75', tf: '15m', provider: 'deriv' },
    { symbol: 'BTCUSDT', tf: '15m', provider: 'binance' }
  ],
  derniers: [],              // 50 dernières alertes envoyées
  deja: []                   // 200 dernières clés déjà notifiées (anti-doublon)
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
  config = c;
  save();
  return config;
}

function resetDedup() { config.deja = []; save(); return config; }

/**
 * Construit le message d'alerte. Toutes les valeurs viennent du signal calculé :
 * aucune n'est inventée, et ce qui manque est simplement absent.
 */
function compose(v, m, prix) {
  const sens = v.direction === 'BUY' ? 'ACHAT' : 'VENTE';
  const couleur = v.direction === 'BUY' ? '#10b981' : '#f2545b';
  const L = v.levels || {};
  const ligne = (k, val) => (val === null || val === undefined ? '' :
    `<tr><td style="padding:3px 10px 3px 0;color:#94a3b8">${k}</td><td style="padding:3px 0"><b>${val}</b></td></tr>`);

  return {
    subject: `[5trade] ${sens} confirmé — ${m.symbol} ${m.tf} (force ${Math.round(v.strength * 100)} %)`,
    html: `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0b1017;color:#e2e8f0;padding:22px;border-radius:12px;max-width:560px">
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
  </table>

  <div style="font-size:13px;color:#cbd5e1;margin-bottom:6px"><b>Règles déclenchées</b></div>
  <ul style="margin:0 0 14px 18px;padding:0;font-size:13px;color:#cbd5e1">
    ${(v.rules || []).map(r => `<li>${r.name} — ${r.detail}</li>`).join('') || '<li>—</li>'}
  </ul>

  <div style="font-size:13px;color:#cbd5e1;margin-bottom:6px"><b>Conditions</b></div>
  <div style="font-size:12.5px;color:#94a3b8">
    ${(v.checklist || []).map(c => `${c.ok ? '✓' : '✗'} ${c.label}`).join(' · ')}
  </div>

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
  if (!c.email) return { controle: false, raison: 'aucun destinataire' };

  const resultats = [];
  let envoyes = 0;

  for (const m of c.marches) {
    try {
      const r = await deps.market.getCandles(m.symbol, m.tf, 300, m.provider);
      const closes = (r.candles || []).filter(x => x.closed !== false);
      if (closes.length < 20) {
        resultats.push({ ...m, verdict: 'données insuffisantes' });
        continue;
      }
      const v = deps.signals.detect(closes, { symbol: m.symbol, timeframe: m.tf });
      if (v.status !== 'confirme') { resultats.push({ ...m, verdict: v.status }); continue; }
      if (v.strength < c.forceMin) {
        resultats.push({ ...m, verdict: `confirmé mais force ${Math.round(v.strength * 100)} % < seuil` });
        continue;
      }
      const cle = `${m.provider}|${m.symbol}|${m.tf}|${v.direction}|${v.at}`;
      if (c.deja.includes(cle)) { resultats.push({ ...m, verdict: 'déjà alerté' }); continue; }

      const msg = compose(v, m, r.candles[r.candles.length - 1].c);
      await deps.sendMail({ to: c.email, subject: msg.subject, html: msg.html });
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

module.exports = { load, save, get, update, resetDedup, verifier, start, stop, compose, DEFAUT };
