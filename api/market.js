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
  label: 'Deriv (Volatility, or, forex)',
  needsKey: false,
  note: 'API v1 (api.derivws.com) — indices synthétiques 24/7, or, forex, crypto. Lecture seule.',
  symbols: [
    { symbol: 'R_10', label: 'Volatility 10', kind: 'synthetic' },
    { symbol: 'R_25', label: 'Volatility 25', kind: 'synthetic' },
    { symbol: 'R_50', label: 'Volatility 50', kind: 'synthetic' },
    { symbol: 'R_75', label: 'Volatility 75', kind: 'synthetic' },
    { symbol: 'R_100', label: 'Volatility 100', kind: 'synthetic' },
    { symbol: '1HZ100V', label: 'Volatility 100 (1 s)', kind: 'synthetic' },
    { symbol: 'frxXAUUSD', label: 'Or / USD (XAUUSD)', kind: 'metal' },
    { symbol: 'frxXAGUSD', label: 'Argent / USD', kind: 'metal' },
    { symbol: 'frxEURUSD', label: 'EUR / USD', kind: 'forex' },
    { symbol: 'frxGBPUSD', label: 'GBP / USD', kind: 'forex' },
    { symbol: 'frxUSDJPY', label: 'USD / JPY', kind: 'forex' },
    { symbol: 'cryBTCUSD', label: 'BTC / USD', kind: 'crypto' },
    { symbol: 'cryETHUSD', label: 'ETH / USD', kind: 'crypto' }
  ],
  // L'ancien point d'entrée ws.derivws.com/websockets/v3 est obsolète (520).
  // L'API v1 expose un WebSocket public pour les données de marché : aucune
  // clé, aucune authentification. (Le trading, lui, exige un token via OTP.)
  ws: 'wss://api.derivws.com/trading/v1/options/ws/public',
  granularity: tf => Math.round(TF_MS[tf] / 1000),
  /** Un aller-retour sur le WebSocket public, en attendant `want`. */
  _askOnce(payload, want, ms = 12000) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.ws);
      const done = (fn, arg) => { clearTimeout(timer); try { socket.close(); } catch {} fn(arg); };
      const timer = setTimeout(() => done(reject, new Error('Deriv : délai dépassé')), ms);
      socket.on('open', () => socket.send(JSON.stringify(payload)));
      socket.on('message', raw => {
        let d; try { d = JSON.parse(raw); } catch { return; }
        if (d.error) return done(reject, new Error('Deriv : ' + d.error.message));
        if (d.msg_type === want) done(resolve, d);
      });
      socket.on('error', e => done(reject, new Error('Deriv : ' + e.message)));
    });
  },
  /**
   * Deriv ferme parfois la toute première connexion (ECONNRESET observé en
   * pratique). Comme c'est transitoire et sans gravité, on retente une fois
   * plutôt que de faire échouer l'affichage du graphique.
   */
  async _ask(payload, want, ms = 12000, essais = 2) {
    for (let i = 1; i <= essais; i++) {
      try { return await this._askOnce(payload, want, ms); }
      catch (e) {
        const transitoire = /ECONNRESET|ECONNREFUSED|socket hang|délai dépassé|timeout/i.test(e.message);
        if (i === essais || !transitoire) throw e;
        await new Promise(r => setTimeout(r, 800));
      }
    }
  },
  _toCandles(list) {
    return (list || []).map(c => ({
      // Temps d'OUVERTURE de la bougie — le seul repère cohérent avec le flux
      // temps réel, qui envoie « open_time ». Utiliser « epoch » ici produisait
      // des bougies décalées d'une période : le direct arrivait avec un
      // horodatage antérieur au dernier point affiché, le graphique l'ignorait
      // et semblait donc FIGÉ (alors que les données arrivaient bien).
      t: (c.open_time !== undefined ? c.open_time : c.epoch) * 1000,
      o: +c.open, h: +c.high, l: +c.low, c: +c.close, v: 0, closed: true
    }));
  },
  async candles(symbol, tf, count) {
    const d = await this._ask({
      ticks_history: symbol, adjust_start_time: 1, count,
      end: 'latest', style: 'candles', granularity: this.granularity(tf), req_id: 1
    }, 'candles');
    return this._toCandles(d.candles);
  },
  streamUrl() { return this.ws; },
  onOpen(ws, symbols, tf) {
    symbols.forEach((s, i) => ws.send(JSON.stringify({
      ticks_history: s, adjust_start_time: 1, count: 1, end: 'latest',
      style: 'candles', granularity: this.granularity(tf), subscribe: 1, req_id: i + 1
    })));
  },
  /** Le direct arrive en msg_type « ohlc » (la bougie en cours se met à jour). */
  parse(msg) {
    if (msg.msg_type !== 'ohlc' || !msg.ohlc) return null;
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

/**
 * Yahoo Finance : les marchés cotés que l'on voit sur TradingView — or et argent
 * COMEX (GC1! / SI1!), pétrole NYMEX, indices CME, forex, crypto.
 *
 * Pourquoi cette source : l'or COMEX (GC=F, bourse CMX) cote environ 1 % au-dessus
 * du spot XAUUSD — c'est le portage du contrat à terme, pas une erreur. Confondre
 * les deux fait croire que « l'app affiche de faux prix ».
 *
 * Pas de clé. Pas de WebSocket public non plus : le moteur interroge à intervalle
 * régulier (voir startPolling).
 */
const UA_YAHOO = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const yahoo = {
  id: 'yahoo',
  label: 'Marchés cotés (COMEX, NYMEX, CME)',
  needsKey: false,
  note: 'Or et argent COMEX (GC1!/SI1!), pétrole, indices, forex, crypto. Sans clé.',
  poll: 20000,
  symbols: [
    { symbol: 'GC=F', label: 'Or COMEX (GC1!)', kind: 'matières premières' },
    { symbol: 'SI=F', label: 'Argent COMEX (SI1!)', kind: 'matières premières' },
    { symbol: 'HG=F', label: 'Cuivre', kind: 'matières premières' },
    { symbol: 'CL=F', label: 'Pétrole WTI', kind: 'matières premières' },
    { symbol: 'NG=F', label: 'Gaz naturel', kind: 'matières premières' },
    { symbol: 'ES=F', label: 'S&P 500 (futures)', kind: 'indices' },
    { symbol: 'NQ=F', label: 'Nasdaq 100 (futures)', kind: 'indices' },
    { symbol: 'YM=F', label: 'Dow Jones (futures)', kind: 'indices' },
    { symbol: 'EURUSD=X', label: 'EUR / USD', kind: 'forex' },
    { symbol: 'GBPUSD=X', label: 'GBP / USD', kind: 'forex' },
    { symbol: 'USDJPY=X', label: 'USD / JPY', kind: 'forex' },
    { symbol: 'DX-Y.NYB', label: 'Indice dollar (DXY)', kind: 'forex' },
    { symbol: 'BTC-USD', label: 'BTC / USD', kind: 'crypto' },
    { symbol: 'ETH-USD', label: 'ETH / USD', kind: 'crypto' }
  ],
  // Yahoo n'accepte que ces intervalles : 4 h est obtenu en regroupant des 1 h.
  _iv: { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '60m', '4h': '60m', '1d': '1d' },
  _range: { '1m': '7d', '5m': '1mo', '15m': '1mo', '30m': '1mo', '1h': '3mo', '4h': '6mo', '1d': '2y' },

  async candles(symbol, tf, count = 300) {
    const iv = this._iv[tf];
    if (!iv) throw new Error(`Unité de temps non gérée par Yahoo : ${tf}`);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
      + `?interval=${iv}&range=${this._range[tf]}`;
    const r = await fetch(url, { headers: { 'User-Agent': UA_YAHOO } });
    if (!r.ok) throw new Error(`Yahoo ${r.status}`);
    const j = await r.json();
    const res = j.chart && j.chart.result && j.chart.result[0];
    if (!res || !res.timestamp) throw new Error(`Symbole inconnu chez Yahoo : ${symbol}`);
    const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
    // Les trous (marché fermé, séance interrompue) arrivent en null : on les jette.
    let cs = res.timestamp.map((t, i) => ({
      t: t * 1000,
      o: q.open ? q.open[i] : null, h: q.high ? q.high[i] : null,
      l: q.low ? q.low[i] : null, c: q.close ? q.close[i] : null,
      v: (q.volume && q.volume[i]) || 0
    })).filter(c => Number.isFinite(c.o) && Number.isFinite(c.c)
      && Number.isFinite(c.h) && Number.isFinite(c.l));

    if (tf === '4h') cs = aggregate(cs, 4);
    if (!cs.length) throw new Error(`Aucune bougie pour ${symbol} en ${tf}`);
    return cs.slice(-count);
  }
};

/** Regroupe des bougies en paquets de `n` (pour fabriquer du 4 h depuis du 1 h). */
function aggregate(candles, n) {
  const out = [];
  for (const c of candles) {
    const last = out[out.length - 1];
    if (last && c.t - last.t < n * 3600e3) {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
      last.v += c.v;
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

const PROVIDERS = { binance, deriv, yahoo, twelvedata };

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

const providerById = id => PROVIDERS[id] || activeProvider();

/**
 * Tous les symboles de TOUS les fournisseurs, chacun étiqueté de sa source :
 * un même écran peut ainsi suivre R_75 (Deriv) et BTCUSDT (Binance).
 */
const listSymbols = () => Object.values(PROVIDERS).flatMap(p =>
  p.symbols
    .filter(s => !(p.needsKey && !process.env.TWELVEDATA_API_KEY))
    .map(s => ({ ...s, provider: p.id, providerLabel: p.label }))
);

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
  // Auto-suffisant : si rien n'est en mémoire (serveur fraîchement démarré),
  // on lit le disque d'abord — sinon l'interface annoncerait « 0 série »
  // alors que le cache existe.
  if (!buffers.size) loadCache();
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
async function getCandles(symbol, tf, count = 300, providerId) {
  if (!TF_MS[tf]) throw new Error(`Timeframe inconnu : ${tf} (attendu ${TIMEFRAMES.join(', ')})`);
  const p = providerId ? providerById(providerId) : activeProvider();
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
function watch(symbol, tf, onCandle, providerId) {
  const p = providerId ? providerById(providerId) : activeProvider();
  if (!TF_MS[tf]) throw new Error(`Timeframe inconnu : ${tf}`);
  const sub = { provider: p.id, symbol, tf, onCandle };
  subscribers.add(sub);

  // Certaines sources n'ont pas de WebSocket public (Yahoo) : on retombe alors
  // sur un relevé périodique. La vérification doit porter sur la présence de la
  // méthode, pas seulement sur son résultat.
  const hasWs = typeof p.streamUrl === 'function' && p.streamUrl([symbol], tf);
  if (hasWs) ensureStream(p, symbol, tf);
  else startPolling(sub);

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
  // Le fournisseur de CET abonnement, pas celui par défaut : sinon suivre un
  // symbole COMEX alors que Binance est actif interrogerait la mauvaise source.
  const p = sub.provider ? providerById(sub.provider) : activeProvider();
  const every = p.poll || Math.max(15000, TF_MS[sub.tf] / 6);
  sub._poll = setInterval(async () => {
    try {
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
