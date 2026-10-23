/**
 * 5trade — HISTORIQUE LONG.
 *
 * Le problème résolu : le cache de marché contient ~300 bougies par série, soit
 * UN JOUR en 5m. Un moteur ne peut pas être évalué, et encore moins apprendre,
 * sur un jour de données. Le backtest existait mais ne voyait jamais plus de
 * 800 bougies (sa propre limite) — et il n'y avait de toute façon rien à lui
 * donner.
 *
 * Ce module télécharge des dizaines de milliers de bougies et les stocke UNE
 * fois, en JSONL, une ligne par bougie. Aucune clé, aucun abonnement :
 *  - Binance  : `/api/v3/klines`, 1000 bougies par appel, pagination par endTime.
 *  - Deriv    : WebSocket public, `ticks_history`, 5000 bougies par appel,
 *               pagination par `end`.
 *
 * Les deux sources sont GRATUITES (contrainte du projet : aucun service payant).
 *
 * Stockage : data/historique/<provider>-<symbol>-<tf>.jsonl
 * Surchargeable par HISTORIQUE_DOSSIER (les tests écrivent ailleurs).
 */

const fs = require('fs');
const path = require('path');
const { TF_MS } = require('./market');

const DOSSIER = process.env.HISTORIQUE_DOSSIER
  || path.join(__dirname, '..', 'data', 'historique');

const BINANCE = 'https://api.binance.com/api/v3/klines';
const DERIV_WS = 'wss://api.derivws.com/trading/v1/options/ws/public';

const MAX_APPEL_BINANCE = 1000;
const MAX_APPEL_DERIV = 5000;

function nomFichier(provider, symbol, tf) {
  const propre = s => String(s).replace(/[^A-Za-z0-9_.-]/g, '_');
  return path.join(DOSSIER, `${propre(provider)}-${propre(symbol)}-${propre(tf)}.jsonl`);
}

function intervalleBinance(tf) {
  // Binance nomme ses intervalles « 5m », « 1h », « 1d » : mêmes libellés que nous.
  const valides = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d']);
  if (!valides.has(tf)) throw new Error(`Intervalle Binance inconnu : ${tf}`);
  return tf;
}

// ─── Téléchargement ──────────────────────────────────────────────────────

/**
 * Binance : on pagine VERS LE PASSÉ depuis maintenant.
 * `endTime` est inclusif — on recule donc d'une milliseconde pour ne pas
 * recevoir deux fois la même bougie frontière.
 */
async function telechargerBinance(symbol, tf, nombre) {
  const interval = intervalleBinance(tf);
  const pas = TF_MS[tf];
  if (!pas) throw new Error(`Unité de temps inconnue : ${tf}`);
  const but = Math.max(1, Math.round(Number(nombre) || 1000));
  let fin = Date.now();
  const parTemps = new Map();

  while (parTemps.size < but) {
    const reste = but - parTemps.size;
    const limite = Math.min(MAX_APPEL_BINANCE, reste);
    const url = `${BINANCE}?symbol=${encodeURIComponent(symbol)}&interval=${interval}`
      + `&limit=${limite}&endTime=${fin}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Binance ${r.status} pour ${symbol} ${tf}`);
    const lignes = await r.json();
    if (!Array.isArray(lignes) || !lignes.length) break;

    for (const l of lignes) {
      const t = Number(l[0]);
      parTemps.set(t, {
        t,
        o: Number(l[1]), h: Number(l[2]), l: Number(l[3]), c: Number(l[4]),
        v: Number(l[5]) || 0,
        closed: true
      });
    }
    const plusAncienne = Math.min(...lignes.map(l => Number(l[0])));
    const suivante = plusAncienne - 1;
    if (!Number.isFinite(suivante) || suivante >= fin) break;   // garde anti-boucle
    fin = suivante;
    await new Promise(r2 => setTimeout(r2, 120));               // on ne martèle pas
  }

  return [...parTemps.values()].sort((a, b) => a.t - b.t);
}

/** Un aller-retour sur le WebSocket public de Deriv, sans dépendance externe. */
function demanderDeriv(payload, want, ms = 20000) {
  return new Promise((resolve, reject) => {
    let socket;
    const finir = (fn, arg) => { clearTimeout(timer); try { socket && socket.close(); } catch {} fn(arg); };
    const timer = setTimeout(() => finir(reject, new Error('Deriv : délai dépassé')), ms);
    try { socket = new WebSocket(DERIV_WS); }
    catch (e) { return finir(reject, e); }
    socket.onopen = () => { try { socket.send(JSON.stringify(payload)); } catch (e) { finir(reject, e); } };
    socket.onerror = e => finir(reject, new Error('Deriv : ' + (e.message || 'erreur réseau')));
    socket.onmessage = raw => {
      let d; try { d = JSON.parse(raw.data || raw); } catch { return; }
      if (d.error) return finir(reject, new Error('Deriv : ' + d.error.message));
      if (d.msg_type === want) finir(resolve, d);
    };
  });
}

/**
 * Deriv : on pagine aussi vers le passé. `end` attend des SECONDES.
 * Le champ de temps est `open_time` (le flux temps réel envoie le même) —
 * utiliser `epoch` décale les bougies d'une période, faute déjà payée sur ce
 * projet.
 */
async function telechargerDeriv(symbol, tf, nombre) {
  const granularite = Math.round(TF_MS[tf] / 1000);
  if (!granularite) throw new Error(`Unité de temps inconnue : ${tf}`);
  const but = Math.max(1, Math.round(Number(nombre) || 1000));
  let end = Math.floor(Date.now() / 1000);
  const parTemps = new Map();

  while (parTemps.size < but) {
    const count = Math.min(MAX_APPEL_DERIV, but - parTemps.size);
    const d = await demanderDeriv({
      ticks_history: symbol, adjust_start_time: 1, count, end,
      style: 'candles', granularity: granularite, req_id: 1
    }, 'candles');
    const list = (d.candles || []).filter(Boolean);
    if (!list.length) break;

    for (const c of list) {
      const t = Number(c.open_time !== undefined ? c.open_time : c.epoch) * 1000;
      parTemps.set(t, {
        t, o: +c.open, h: +c.high, l: +c.low, c: +c.close, v: 0, closed: true
      });
    }
    const plusAncienne = Math.min(...list.map(c => Number(c.open_time !== undefined ? c.open_time : c.epoch)));
    const suivante = plusAncienne - 1;
    if (!Number.isFinite(suivante) || suivante >= end) break;
    end = suivante;
  }

  return [...parTemps.values()].sort((a, b) => a.t - b.t);
}

/**
 * YAHOO — la seule source qui donne des marchés RÉELS sur plusieurs années sans
 * clé d'API. Deriv ne remonte pas assez loin et surtout : ses indices synthétiques
 * sortent d'un RNG cryptographique, donc un backtest dessus ne prouve rien.
 * Ici on a de l'or (GC=F), du forex et du BTC réels sur 2 ans.
 */
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';
const RANGE_YAHOO = { '1m': '7d', '5m': '60d', '15m': '60d', '30m': '60d', '1h': '2y', '1d': '10y' };

async function telechargerYahoo(symbol, tf, nombre) {
  const interval = tf === '1h' ? '1h' : tf;
  const range = RANGE_YAHOO[interval] || '2y';
  const url = `${YAHOO}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const rep = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!rep.ok) throw new Error(`Yahoo ${rep.status} pour ${symbol} ${tf}`);
  const j = await rep.json();
  const r = j?.chart?.result?.[0];
  if (!r || !r.timestamp) throw new Error(`Yahoo : aucune donnée pour ${symbol} ${tf}`);

  const q = r.indicators.quote[0];
  const bougies = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    // Une bougie incomplète (close null) est écartée : la garder produirait un
    // trou que le moteur lirait comme un prix.
    if (q.open[i] == null || q.close[i] == null || q.high[i] == null || q.low[i] == null) continue;
    bougies.push({
      t: r.timestamp[i] * 1000,
      o: +q.open[i], h: +q.high[i], l: +q.low[i], c: +q.close[i],
      v: +(q.volume[i] || 0), closed: true
    });
  }
  const triees = bougies.sort((a, b) => a.t - b.t);
  return nombre ? triees.slice(-Math.round(Number(nombre))) : triees;
}

/** Choisit la source : Binance pour les paires *USDT, Deriv pour le reste. */
function sourcePour(symbol, provider) {
  if (provider) return provider;
  if (/USDT$/i.test(symbol)) return 'binance';
  if (/^(GC=F|EURUSD=X|BTC-USD|ES=F|CL=F|^[A-Z]{1,5}=X)$/i.test(symbol)) return 'yahoo';
  return 'deriv';
}

/**
 * Télécharge et ÉCRIT le fichier. Rend ce qui a été obtenu, pas ce qui a été
 * demandé : un appel qui rend 3000 bougies sur 20000 demandées doit se voir.
 */
async function telecharger({ symbol, tf = '5m', nombre = 5000, provider = null }) {
  if (!symbol) throw new Error('symbol est requis');
  const src = sourcePour(symbol, provider);
  const bougies = src === 'binance' ? await telechargerBinance(symbol, tf, nombre)
    : src === 'yahoo' ? await telechargerYahoo(symbol, tf, nombre)
    : await telechargerDeriv(symbol, tf, nombre);
  if (!bougies.length) throw new Error(`Aucune bougie reçue pour ${symbol} ${tf} (${src})`);

  fs.mkdirSync(DOSSIER, { recursive: true });
  const fichier = nomFichier(src, symbol, tf);
  const contenu = bougies.map(c => JSON.stringify(c)).join('\n') + '\n';
  const tmp = `${fichier}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contenu);
  fs.renameSync(tmp, fichier);      // atomique, même raison que le journal

  return {
    provider: src, symbol, tf, fichier,
    demandees: Math.round(Number(nombre) || 0),
    obtenues: bougies.length,
    debut: bougies[0].t,
    fin: bougies[bougies.length - 1].t,
    jours: +(((bougies[bougies.length - 1].t - bougies[0].t) / 86400000).toFixed(1))
  };
}

// ─── Lecture ─────────────────────────────────────────────────────────────

/** Relit une série stockée. Rend [] si le fichier n'existe pas. */
function charger(provider, symbol, tf) {
  const fichier = nomFichier(provider, symbol, tf);
  let brut;
  try { brut = fs.readFileSync(fichier, 'utf8'); } catch { return []; }
  const out = [];
  for (const ligne of brut.split('\n')) {
    if (!ligne.trim()) continue;
    try {
      const c = JSON.parse(ligne);
      if (Number.isFinite(c.t) && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c)) {
        out.push(c);
      }
    } catch { /* une ligne abîmée ne doit pas rendre toute la série illisible */ }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Ce qui est déjà sur le disque : le point de départ de tout travail hors ligne. */
function lister() {
  let noms = [];
  try { noms = fs.readdirSync(DOSSIER).filter(n => n.endsWith('.jsonl')); } catch { return []; }
  return noms.map(n => {
    const p = path.join(DOSSIER, n);
    const st = fs.statSync(p);
    const serie = charger(...decomposer(n));
    return {
      fichier: p,
      provider: decomposer(n)[0], symbol: decomposer(n)[1], tf: decomposer(n)[2],
      bougies: serie.length,
      debut: serie.length ? serie[0].t : null,
      fin: serie.length ? serie[serie.length - 1].t : null,
      tailleKo: Math.round(st.size / 1024)
    };
  });
}

function decomposer(nom) {
  const base = nom.replace(/\.jsonl$/, '');
  const [provider, symbol, tf] = base.split('-');
  return [provider, symbol, tf];
}

module.exports = {
  DOSSIER, nomFichier, telecharger, telechargerBinance, telechargerDeriv,
  charger, lister, sourcePour
};

// ─── Ligne de commande : node historique.js R_75 5m 20000 ────────────────
if (require.main === module) {
  const [symbol, tf = '5m', nombre = '5000'] = process.argv.slice(2);
  if (!symbol) {
    console.log('usage : node historique.js <symbole> [tf] [nombre]');
    process.exit(1);
  }
  telecharger({ symbol, tf, nombre: Number(nombre) })
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
}
