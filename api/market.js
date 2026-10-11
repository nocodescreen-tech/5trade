/**
 * 5trade — moteur de marché temps réel + historique exact.
 *
 * POURQUOI CE MODULE
 * Jusqu'ici l'analyse partait d'une capture d'écran : le modèle devait
 * « lire » des bougies sur une image, ce qui est approximatif par nature.
 * Ici on récupère les bougies OHLCV réelles (REST) et on suit la bougie en
 * cours en direct (WebSocket). L'analyse travaille alors sur des nombres
 * exacts — plus de niveaux devinés.
 *
 * FOURNISSEURS
 *   binance  → par défaut, aucune clé requise. Crypto + proxys utiles :
 *              EURUSDT ≈ EURUSD, PAXGUSDT ≈ or (XAU/USD).
 *   deriv    → indices synthétiques (R_75 = Volatility 75). Prêt, mais l'API
 *              Deriv renvoie actuellement 520 (Cloudflare) depuis ce réseau :
 *              le moteur bascule alors proprement sur binance.
 *   twelvedata → forex/indices, nécessite TWELVEDATA_API_KEY.
 *
 * Dépendance : `ws` (0 sous-dépendance). L'agrégation est déléguée au
 * fournisseur : Binance pousse directement la bougie en cours des klines,
 * donc aucun tick n'est perdu ni mal agrégé.
 */
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Cache disque : permet d'analyser même sans réseau (le buffer mémoire seul
// disparaît à chaque redémarrage du serveur).
const CACHE_FILE = path.join(__dirname, '..', 'data', 'market-cache.json');
const CACHE_KEEP = 400;

const TF_MS = {
  '1m': 60e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3,
  '1h': 3600e3, '4h': 14400e3, '1d': 86400e3
};
const TIMEFRAMES = Object.keys(TF_MS);

// ─────────────────────────────────────────────────────────────
// Fournisseur : Binance
// ─────────────────────────────────────────────────────────────
const binance = {
  id: 'binance',
  label: 'Binance',
  needsKey: false,
  note: 'Crypto + proxys : EURUSDT ≈ EURUSD, PAXGUSDT ≈ or',
  symbols: [
    { symbol: 'BTCUSDT', label: 'BTC / USD', kind: 'crypto' },
    { symbol: 'ETHUSDT', label: 'ETH / USD', kind: 'crypto' },
    { symbol: 'SOLUSDT', label: 'SOL / USD', kind: 'crypto' },
    { symbol: 'XRPUSDT', label: 'XRP / USD', kind: 'crypto' },
    { symbol: 'PAXGUSDT', label: 'Or tokenisé / USD  (proche XAUUSD)', kind: 'metal' },
    { symbol: 'EURUSDT', label: 'EUR / USD', kind: 'forex' },
    { symbol: 'GBPUSDT', label: 'GBP / USD', kind: 'forex' }
  ],
  async candles(symbol, tf, count) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${tf}&limit=${Math.min(count, 1000)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Binance REST ${r.status}`);
    const rows = await r.json();
    return rows.map(k => ({
      t: k[0],                      // epoch ms d'ouverture
      o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5],
      closed: true
    }));
  },
  streamUrl(symbols, tf) {
    const streams = symbols.map(s => `${s.toLowerCase()}@kline_${tf}`).join('/');
    return `wss://stream.binance.com:9443/stream?streams=${streams}`;
  },
  /** Binance envoie {data:{s, k:{t,o,h,l,c,v,x}}} */
  parse(msg) {
    const k = msg && msg.data && msg.data.k;
    if (!k) return null;
    return {
      symbol: msg.data.s,
      candle: { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v, closed: !!k.x }
    };
  }
};

// ─────────────────────────────────────────────────────────────
// Fournisseur : Deriv (prêt — indisponible si l'API ne répond pas)
// ─────────────────────────────────────────────────────────────
const deriv = {
  id: 'deriv',
  label: 'Deriv (indices synthétiques)',
  needsKey: false,
  note: 'R_75 = Volatility 75. API actuellement en 520 depuis ce réseau.',
  symbols: [
    { symbol: 'R_75', label: 'Volatility 75', kind: 'synthetic' },
    { symbol: 'R_25', label: 'Volatility 25', kind: 'synthetic' },
    { symbol: 'R_100', label: 'Volatility 100', kind: 'synthetic' },
    { symbol: 'frxXAUUSD', label: 'Or / USD (XAUUSD)', kind: 'metal' },
    { symbol: 'frxEURUSD', label: 'EUR / USD', kind: 'forex' }
  ],
  url() { return `wss://ws.derivws.com/websockets/v3?app_id=${process.env.DERIV_APP_ID || 1089}`; },
  async candles(symbol, tf, count) {
    // L'API Deriv v3 est WebSocket-only : on demande l'historique par WS.
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url());
      const to = setTimeout(() => { try { ws.terminate(); } catch {} reject(new Error('Deriv : délai dépassé')); }, 12000);
      ws.on('open', () => ws.send(JSON.stringify({
        ticks_history: symbol, adjust_start_time: 1, count,
        end: 'latest', style: 'candles', granularity: Math.round(TF_MS[tf] / 1000)
      })));
      ws.on('message', m => {
        const d = JSON.parse(m);
        if (d.error) { clearTimeout(to); try { ws.close(); } catch {} return reject(new Error('Deriv : ' + d.error.message)); }
        if (d.msg_type === 'candles') {
          clearTimeout(to); try { ws.close(); } catch {}
          resolve((d.candles || []).map(c => ({
            t: c.epoch * 1000, o: +c.open, h: +c.high, l: +c.low, c: +c.close, v: 0, closed: true
          })));
        }
      });
      ws.on('error', e => { clearTimeout(to); reject(new Error('Deriv : ' + e.message)); });
    });
  },
  streamUrl() { return this.url(); },
  onOpen(ws, symbols, tf) {
    // Si un token en LECTURE SEULE est fourni, on s'authentifie pour pouvoir
    // lire le compte (solde, positions). Le token se crée soi-même dans le
    // tableau de bord Deriv en cochant UNIQUEMENT « Read » : jamais le mot de
    // passe, et aucune capacité d'ordre ni de retrait.
    const token = process.env.DERIV_API_TOKEN;
    if (token) {
      ws.send(JSON.stringify({ authorize: token }));
    }
    for (const s of symbols) {
      ws.send(JSON.stringify({ ticks_history: s, adjust_start_time: 1, count: 1, end: 'latest', style: 'candles', granularity: Math.round(TF_MS[tf] / 1000), subscribe: 1 }));
    }
  },
  parse(msg) {
    if (msg.msg_type !== 'ohlc') return null;
    const o = msg.ohlc;
    return {
      symbol: o.symbol,
      candle: { t: o.open_time * 1000, o: +o.open, h: +o.high, l: +o.low, c: +o.close, v: 0, closed: false }
    };
  }
};

// ─────────────────────────────────────────────────────────────
// Fournisseur : Twelve Data (forex / indices, clé requise)
// ─────────────────────────────────────────────────────────────
const twelvedata = {
  id: 'twelvedata',
  label: 'Twelve Data (forex, indices)',
  needsKey: true,
  note: 'Nécessite TWELVEDATA_API_KEY (offre gratuite disponible).',
  symbols: [
    { symbol: 'XAU/USD', label: 'Or / USD', kind: 'metal' },
    { symbol: 'EUR/USD', label: 'EUR / USD', kind: 'forex' },
    { symbol: 'GBP/USD', label: 'GBP / USD', kind: 'forex' },
    { symbol: 'US30', label: 'Dow Jones 30', kind: 'index' },
    { symbol: 'NAS100', label: 'Nasdaq 100', kind: 'index' }
  ],
  async candles(symbol, tf, count) {
    const key = process.env.TWELVEDATA_API_KEY;
    if (!key) throw new Error('TWELVEDATA_API_KEY absente');
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${tf}&outputsize=${count}&apikey=${key}`;
    const r = await fetch(url);
    const d = await r.json();
    if (d.status === 'error' || !d.values) throw new Error('Twelve Data : ' + (d.message || 'réponse invalide'));
    return d.values.map(v => ({
      t: new Date(v.datetime.replace(' ', 'T') + 'Z').getTime(),
      o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +(v.volume || 0), closed: true
    })).reverse();
  },
  streamUrl() { return null; },   // le direct passe par le polling REST
  parse() { return null; }
};

const PROVIDERS = { binance, deriv, twelvedata };

const activeProvider = () => {
  const id = (process.env.MARKET_PROVIDER || 'binance').toLowerCase();
  return PROVIDERS[id] || binance;
};

const providerStatus = () => {
  const p = activeProvider();
  return {
    provider: p.id, label: p.label, needsKey: p.needsKey,
    configured: !p.needsKey || !!process.env.TWELVEDATA_API_KEY,
    note: p.note,
    timeframes: TIMEFRAMES,
    available: Object.values(PROVIDERS).map(x => ({ id: x.id, label: x.label, needsKey: x.needsKey }))
  };
};

const listSymbols = () => activeProvider().symbols;

// ─────────────────────────────────────────────────────────────
// Cache de bougies + flux temps réel
// ─────────────────────────────────────────────────────────────
const buffers = new Map();          // "provider|symbol|tf" -> candles[]
const subscribers = new Set();      // {provider, symbol, tf, onCandle}
let ws = null, wsProvider = null, wsSymbols = [], wsTf = null, pingTimer = null;

const keyOf = (p, s, tf) => `${p}|${s}|${tf}`;

// ─── Cache disque (mode hors ligne) ───
function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return 0;
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    let n = 0;
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v) && v.length) { buffers.set(k, v); n++; }
    }
    return n;
  } catch { return 0; }
}

let cacheTimer = null;
/** Écriture différée : on ne touche pas au disque à chaque tick. */
function saveCacheSoon() {
  if (cacheTimer) return;
  cacheTimer = setTimeout(() => {
    cacheTimer = null;
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      const out = {};
      for (const [k, v] of buffers) out[k] = v.slice(-CACHE_KEEP);
      fs.writeFileSync(CACHE_FILE, JSON.stringify(out));
    } catch { /* disque indisponible : ce n'est qu'un cache */ }
  }, 5000);
}

/** Nombre de séries disponibles hors ligne (pour l'interface). */
function cacheInfo() {
  const series = [];
  for (const [k, v] of buffers) {
    const [provider, symbol, tf] = k.split('|');
    if (v.length) series.push({ provider, symbol, tf, candles: v.length, last: v[v.length - 1].t });
  }
  return { cached: series.length, series: series.sort((a, b) => b.last - a.last).slice(0, 20) };
}

/**
 * Bougies exactes (REST pour l'historique, buffer live si disponible).
 * Si le réseau échoue, on sert le cache : l'analyse reste possible hors ligne.
 * @returns {Promise<{candles:Array, provider:string, source:string, offline?:boolean}>}
 */
async function getCandles(symbol, tf, count = 300) {
  if (!TF_MS[tf]) throw new Error(`Timeframe inconnu : ${tf} (attendu ${TIMEFRAMES.join(', ')})`);
  const p = activeProvider();
  const k = keyOf(p.id, symbol, tf);
  const buf = buffers.get(k);

  if (buf && buf.length >= Math.min(count, 500)) {
    return { candles: buf.slice(-count), provider: p.id, source: 'live' };
  }
  try {
    const candles = await p.candles(symbol, tf, count);
    buffers.set(k, candles);
    saveCacheSoon();
    return { candles, provider: p.id, source: 'rest' };
  } catch (e) {
    // HORS LIGNE : on sert ce qu'on a en mémoire, sinon sur disque.
    if (!buf || !buf.length) loadCache();
    const fallback = buffers.get(k);
    if (fallback && fallback.length) {
      return {
        candles: fallback.slice(-count), provider: p.id, source: 'cache',
        offline: true, error: e.message
      };
    }
    throw e;   // rien en cache : l'erreur est légitime
  }
}

/** Applique une bougie live au buffer (remplace la dernière si même ouverture). */
function applyCandle(providerId, symbol, tf, candle) {
  const k = keyOf(providerId, symbol, tf);
  let buf = buffers.get(k);
  if (!buf || !buf.length) { buffers.set(k, [candle]); saveCacheSoon(); return; }
  const last = buf[buf.length - 1];
  if (last.t === candle.t) buf[buf.length - 1] = candle;
  else if (candle.t > last.t) {
    if (buf.length > 3000) buf.shift();
    buf.push(candle);
    saveCacheSoon();
  }
}

/**
 * Ouvre (ou réutilise) le flux temps réel et notifie à chaque bougie.
 * @returns {function} arrêt de l'abonnement de cet appelant
 */
function watch(symbol, tf, onCandle) {
  const p = activeProvider();
  if (!TF_MS[tf]) throw new Error(`Timeframe inconnu : ${tf}`);
  const sub = { provider: p.id, symbol, tf, onCandle };
  subscribers.add(sub);

  if (p.streamUrl([symbol], tf)) ensureStream(p, symbol, tf);
  else startPolling(sub);          // fournisseur sans WS (Twelve Data)

  return () => {
    subscribers.delete(sub);
    if (sub._poll) clearInterval(sub._poll);
    // Plus aucun abonné : on libère la connexion temps réel au lieu de la
    // laisser ouverte indéfiniment (une seule suffit, mais pas zéro abonné).
    if (subscribers.size === 0) closeStream();
  };
}

function ensureStream(p, symbol, tf) {
  const sameTf = ws && wsProvider === p.id && wsTf === tf;
  if (sameTf) {
    if (!wsSymbols.includes(symbol)) {
      wsSymbols.push(symbol);
      if (p.id === 'binance') reopenStream(p, wsSymbols, tf);
      else if (p.onOpen) p.onOpen(ws, [symbol], tf);
    }
    return;
  }
  reopenStream(p, [...new Set([symbol, ...(wsProvider === p.id ? wsSymbols : [])])], tf);
}

function reopenStream(p, symbols, tf) {
  closeStream();
  wsProvider = p.id; wsSymbols = symbols; wsTf = tf;
  try { ws = new WebSocket(p.streamUrl(symbols, tf)); }
  catch (e) { console.error('   Marché     : flux indisponible —', e.message); ws = null; return; }

  ws.on('open', () => {
    console.log(`   Marché     : direct ${p.id} ${symbols.join(',')} ${tf}`);
    if (p.onOpen) p.onOpen(ws, symbols, tf);
    // Binance coupe une connexion inactive : on ping toutes les 3 minutes.
    pingTimer = setInterval(() => { try { ws.ping(); } catch {} }, 180000);
  });
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const parsed = p.parse(msg);
    if (!parsed) return;
    applyCandle(p.id, parsed.symbol, tf, parsed.candle);
    for (const s of subscribers) {
      if (s.provider === p.id && s.tf === tf && s.symbol === parsed.symbol) {
        try { s.onCandle(parsed.candle); } catch {}
      }
    }
  });
  ws.on('error', () => {});
  ws.on('close', () => {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    // Reconnexion si des abonnés attendent encore ce flux
    if (subscribers.size && wsProvider === p.id && wsTf === tf) {
      setTimeout(() => { if (subscribers.size) reopenStream(p, wsSymbols, wsTf); }, 3000);
    }
  });
}

function closeStream() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  const sock = ws;
  ws = null;                       // plus aucune référence active
  if (!sock) return;
  // PIÈGE (bug vécu) : un socket encore en cours de connexion ne peut pas être
  // « close ». close() émet alors une erreur 'WebSocket was closed before the
  // connection was established' et, si plus aucun écouteur 'error' n'est
  // attaché, cette erreur devient non gérée et TUE le process Node.
  // → on coupe net avec terminate(), et on ne retire jamais les écouteurs.
  try {
    if (sock.readyState === 0 /* CONNECTING */) sock.terminate();
    else sock.close();
  } catch { /* socket déjà mort : rien à faire */ }
  console.log('   Marché     : flux temps réel libéré');
}

/** Fournisseur sans WebSocket : on rafraîchit par polling REST. */
function startPolling(sub) {
  if (sub._poll) return;
  const every = Math.max(15000, TF_MS[sub.tf] / 6);
  sub._poll = setInterval(async () => {
    try {
      const p = activeProvider();
      const candles = await p.candles(sub.symbol, sub.tf, 2);
      const last = candles[candles.length - 1];
      if (last) { applyCandle(p.id, sub.symbol, sub.tf, { ...last, closed: false }); sub.onCandle(last); }
    } catch {}
  }, every);
}

/**
 * Test de disponibilité d'un fournisseur — utilisé au démarrage et par l'UI.
 */
async function probe(id) {
  const p = PROVIDERS[id] || binance;
  if (p.needsKey && !process.env.TWELVEDATA_API_KEY) {
    return { id: p.id, ok: false, detail: 'clé API manquante' };
  }
  const s = p.symbols[0];
  const t0 = Date.now();
  try {
    const c = await p.candles(s.symbol, '1m', 3);
    return { id: p.id, ok: c.length > 0, detail: `${c.length} bougies`, ms: Date.now() - t0 };
  } catch (e) {
    return { id: p.id, ok: false, detail: e.message, ms: Date.now() - t0 };
  }
}

module.exports = {
  TIMEFRAMES, TF_MS,
  listSymbols, getCandles, watch, probe, providerStatus,
  activeProvider: () => activeProvider().id,
  closeStream,
  loadCache, cacheInfo
};
