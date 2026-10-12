/**
 * 5trade — journal de trades : normalisation + statistiques.
 *
 * Un trade est un objet JSON plat :
 *   { id, pair, direction, entry, sl, tp, size, risk, reward, plannedRR,
 *     strategyIds[], notes, originAnalysisId, openedAt, status,
 *     exit, pnl, rr, result, closedAt, createdAt }
 *
 * Conventions :
 *   result : 'win' | 'loss' | 'breakeven' (déduit du prix si non fourni)
 *   rr     : risque-réalisé, en multiples du risque initial (1R = risque)
 *   pnl    : valeur libre fournie par le trader (devise ou R), jamais inventée
 */

const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// Un prix d'entrée peut être exprimé à 0,0001 près (EURUSD) comme à l'unité (or).
// Arrondir le PnL à 2 décimales mettrait tous les trades forex à zéro :
// on garde 6 décimales significatives, et 2 suffisent pour un multiple de risque.
const roundPnl = v => (v === null || v === undefined ? null : +Number(v).toFixed(6));
const roundRR  = v => (v === null || v === undefined ? null : +Number(v).toFixed(2));

/** Valide et normalise un nouveau trade (statut « open »). */
function normalize(input = {}) {
  const direction = String(input.direction || '').toUpperCase();
  if (!['BUY', 'SELL'].includes(direction)) {
    throw new Error("« direction » doit être BUY ou SELL");
  }
  const pair = String(input.pair || '').trim().toUpperCase();
  if (!pair) throw new Error('« pair » est requise');

  const entry = num(input.entry);
  if (entry === null) throw new Error('« entry » (prix d\'entrée) est requis');

  const sl = num(input.sl);
  const tp = num(input.tp);
  if (sl !== null) {
    if (direction === 'BUY' && sl >= entry) throw new Error('Pour un BUY, le SL doit être sous l\'entrée');
    if (direction === 'SELL' && sl <= entry) throw new Error('Pour un SELL, le SL doit être au-dessus de l\'entrée');
  }
  if (tp !== null) {
    if (direction === 'BUY' && tp <= entry) throw new Error('Pour un BUY, le TP doit être au-dessus de l\'entrée');
    if (direction === 'SELL' && tp >= entry) throw new Error('Pour un SELL, le TP doit être sous l\'entrée');
  }

  const risk = sl !== null ? Math.abs(entry - sl) : null;
  const reward = tp !== null ? Math.abs(tp - entry) : null;

  return {
    pair, direction, entry, sl, tp,
    size: num(input.size),
    // Origine du marché : sans elle, les statistiques mélangent des marchés qui
    // n'ont rien à voir (R_75 en 5m chez Deriv et BTC en 1h chez Binance). C'est
    // ce qui permet de répondre à « est-ce que je gagne SUR R_75 ? ».
    timeframe: input.timeframe ? String(input.timeframe).slice(0, 8) : null,
    provider: input.provider ? String(input.provider).slice(0, 24) : null,
    providerLabel: input.providerLabel ? String(input.providerLabel).slice(0, 60) : null,
    signalStatus: input.signalStatus ? String(input.signalStatus).slice(0, 16) : null,
    signalStrength: num(input.signalStrength),
    risk, reward,
    plannedRR: risk && reward ? +(reward / risk).toFixed(2) : null,
    strategyIds: Array.isArray(input.strategyIds) ? input.strategyIds.map(String) : [],
    notes: String(input.notes || '').slice(0, 2000),
    originAnalysisId: input.originAnalysisId ? String(input.originAnalysisId) : null,
    openedAt: input.openedAt || new Date().toISOString(),
    status: 'open',
    exit: null, pnl: null, rr: null, result: null, closedAt: null,
    createdAt: new Date().toISOString()
  };
}

/** Clôture un trade : résultat déduit du prix, incohérences refusées. */
function close(trade, input = {}) {
  if (trade.status === 'closed') throw new Error('Ce trade est déjà clôturé');

  const exit = num(input.exit);
  if (exit === null) throw new Error('« exit » (prix de sortie) est requis pour clôturer');

  // Le prix de sortie est la source de vérité du résultat.
  const gain = trade.direction === 'BUY' ? exit - trade.entry : trade.entry - exit;
  const fromPrice = gain > 0 ? 'win' : gain < 0 ? 'loss' : 'breakeven';

  let result = fromPrice;
  if (input.result) {
    const r = String(input.result).toLowerCase();
    if (!['win', 'loss', 'breakeven'].includes(r)) {
      throw new Error('« result » doit être win, loss ou breakeven');
    }
    // « breakeven » reste un jugement du trader ; win/loss ne peuvent pas
    // contredire le prix de sortie.
    if (r !== fromPrice && r !== 'breakeven') {
      throw new Error(`« result » (${r}) contredit le prix de sortie, qui donne ${fromPrice}`);
    }
    result = r;
  }

  const pnl = num(input.pnl);
  const rr = num(input.rr);

  // Sans cette garde, un pnl contradictoire fausserait toutes les statistiques.
  if (pnl !== null) {
    if (result === 'win' && pnl < 0) throw new Error('« pnl » négatif alors que le trade est gagnant');
    if (result === 'loss' && pnl > 0) throw new Error('« pnl » positif alors que le trade est perdant');
  }
  if (rr !== null) {
    if (result === 'win' && rr < 0) throw new Error('« rr » négatif alors que le trade est gagnant');
    if (result === 'loss' && rr > 0) throw new Error('« rr » positif alors que le trade est perdant');
  }

  return {
    ...trade,
    status: 'closed',
    exit,
    result,
    // rr fourni, sinon déduit du pnl ; pnl fourni, sinon déduit du rr
    rr: roundRR(rr !== null ? rr : (pnl !== null && trade.risk ? pnl / trade.risk : null)),
    pnl: roundPnl(pnl !== null ? pnl : (rr !== null && trade.risk ? rr * trade.risk : null)),
    closedAt: input.closedAt || new Date().toISOString(),
    notes: input.notes !== undefined ? String(input.notes).slice(0, 2000) : trade.notes
  };
}

const pct = (part, whole) => (whole ? +((part / whole) * 100).toFixed(1) : null);
const sum = (arr, f) => arr.reduce((a, x) => a + (Number(f(x)) || 0), 0);
const mean = (arr, f, decimals = 2) =>
  (arr.length ? +(sum(arr, f) / arr.length).toFixed(decimals) : null);

/**
 * Statistiques du journal. `titles` mappe strategyId → titre lisible.
 * Seuls les trades clôturés entrent dans le taux de réussite.
 */
function computeStats(trades, titles = {}) {
  const closed = trades.filter(t => t.status === 'closed');
  const wins = closed.filter(t => t.result === 'win');
  const losses = closed.filter(t => t.result === 'loss');
  const flats = closed.filter(t => t.result === 'breakeven');

  const withPnl = closed.filter(t => t.pnl !== null && t.pnl !== undefined);
  const withRr = closed.filter(t => t.rr !== null && t.rr !== undefined);

  // Séries consécutives (sur les trades clôturés, du plus ancien au plus récent)
  const chrono = [...closed].sort((a, b) => new Date(a.closedAt || 0) - new Date(b.closedAt || 0));
  let streakType = null, streakCount = 0;
  for (let i = chrono.length - 1; i >= 0; i--) {
    const r = chrono[i].result;
    if (r === 'breakeven') break;
    if (streakType === null) { streakType = r; streakCount = 1; }
    else if (r === streakType) streakCount++;
    else break;
  }

  const group = (keyFn, labelOf) => {
    const map = new Map();
    for (const t of closed) {
      const key = keyFn(t) || '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    }
    return [...map.entries()].map(([key, list]) => {
      const w = list.filter(t => t.result === 'win').length;
      return {
        key,
        label: labelOf ? labelOf(key) : key,
        trades: list.length,
        wins: w,
        losses: list.filter(t => t.result === 'loss').length,
        winRate: pct(w, list.length),
        pnl: sum(list.filter(t => t.pnl != null), t => t.pnl),
        rrAvg: mean(list.filter(t => t.rr != null), t => t.rr)
      };
    }).sort((a, b) => b.trades - a.trades);
  };

  return {
    total: trades.length,
    open: trades.length - closed.length,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: flats.length,
    winRate: pct(wins.length, closed.length),
    pnlTotal: withPnl.length ? +sum(withPnl, t => t.pnl).toFixed(6) : null,
    pnlAvg: mean(withPnl, t => t.pnl, 6),
    rrAvg: mean(withRr, t => t.rr, 2),
    best: withPnl.length ? withPnl.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null,
    worst: withPnl.length ? withPnl.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null,
    streak: streakType ? { type: streakType, count: streakCount } : null,
    openRisk: +sum(trades.filter(t => t.status === 'open' && t.risk != null), t => t.risk).toFixed(6) || null,
    byStrategy: group(t => (t.strategyIds || [])[0], id => titles[id] || id),
    byPair: group(t => t.pair),
    // Marché = instrument + unité de temps. C'est la question utile :
    // « sur quel marché est-ce que je gagne vraiment ? »
    byMarket: group(t => [t.pair, t.timeframe].filter(Boolean).join(' · ')),
    bySource: group(t => t.providerLabel || t.provider || '—'),
    byTimeframe: group(t => t.timeframe || '—'),
    byDirection: group(t => t.direction)
  };
}

module.exports = { normalize, close, computeStats, num };
