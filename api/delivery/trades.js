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
  if (entry <= 0) throw new Error('« entry » (prix d\'entrée) doit être positif');
  // Un prix nul ou négatif n'existe pas : le laisser passer ferait ensuite des
  // pourcentages absurdes (et un risque négatif dans les statistiques).
  if (entry <= 0) throw new Error('« entry » doit être un prix strictement positif');

  const sl = num(input.sl);
  const tp = num(input.tp);
  // SL et TP sont des PRIX : zéro ou négatif n'a pas de sens.
  if (sl !== null && sl <= 0) throw new Error('« sl » doit être un prix strictement positif');
  if (tp !== null && tp <= 0) throw new Error('« tp » doit être un prix strictement positif');
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

  // Une taille nulle ou négative n'a pas de sens, et fausserait le risque total.
  const size = num(input.size);
  if (size !== null && size <= 0) throw new Error('« size » doit être strictement positive');

  return {
    pair, direction, entry, sl, tp,
    size,
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

  // GARDE-FOU : si trade.risk est 0 ou null, on ne peut pas déduire rr/pnl.
  // Sans cette garde, pnl / 0 = Infinity et rr * 0 = 0, ce qui corrompt
  // toutes les statistiques (rrAvg devient Infinity).
  const safeRisk = trade.risk && trade.risk > 0 ? trade.risk : null;
  return {
    ...trade,
    status: 'closed',
    exit,
    result,
    // rr fourni, sinon déduit du pnl ; pnl fourni, sinon déduit du rr
    rr: roundRR(rr !== null ? rr : (pnl !== null && safeRisk ? pnl / safeRisk : null)),
    pnl: roundPnl(pnl !== null ? pnl : (rr !== null && safeRisk ? rr * safeRisk : null)),
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

/**
 * Calcul de la taille de position basée sur le risque en % du capital.
 *
 * Formule : taille = (capital × risquePct) / (stopDistance × valeurParUnité)
 *
 * @param {object} params
 * @param {number} params.capital - Capital total du compte
 * @param {number} params.risquePct - Risque en % du capital (ex: 1 = 1%)
 * @param {number} params.entry - Prix d'entrée
 * @param {number} params.stop - Prix du stop loss
 * @param {number} [params.valeurParUnité] - Valeur d'une unité de position (défaut: 1)
 * @returns {{ taille: number, risqueMontant: number, stopPct: number }}
 */
function positionSizing({ capital, risquePct, entry, stop, valeurParUnite = 1 }) {
  if (!capital || capital <= 0) throw new Error('Le capital doit être positif');
  if (!risquePct || risquePct <= 0) throw new Error('Le risque en % doit être positif');
  if (!entry || entry <= 0) throw new Error('Le prix d\'entrée doit être positif');
  if (!stop || stop <= 0) throw new Error('Le stop loss doit être positif');

  const stopDistance = Math.abs(entry - stop);
  if (stopDistance === 0) throw new Error('La distance du stop ne peut pas être zéro');

  const risqueMontant = (capital * risquePct) / 100;
  const taille = risqueMontant / (stopDistance * valeurParUnite);
  const stopPct = (stopDistance / entry) * 100;

  return {
    taille: +taille.toFixed(4),
    risqueMontant: +risqueMontant.toFixed(2),
    stopPct: +stopPct.toFixed(3)
  };
}

/**
 * Filtre de spread : un signal dont le spread mange le profit est rejeté.
 *
 * @param {object} params
 * @param {number} params.spread - Spread en pips/points
 * @param {number} params.targetDistance - Distance en prix jusqu'à l'objectif
 * @param {number} [params.seuilPct] - Seuil en % du profit (défaut: 0.3 = 30%)
 * @returns {{ ok: boolean, spreadCoutPct: number, message: string }}
 */
function filtreSpread({ spread, targetDistance, seuilPct = 0.3 }) {
  if (!spread || spread < 0) throw new Error('Le spread doit être positif');
  if (!targetDistance || targetDistance <= 0) throw new Error('La distance de l\'objectif doit être positif');

  const spreadCoutPct = (spread / targetDistance) * 100;
  const ok = spreadCoutPct < (seuilPct * 100);

  return {
    ok,
    spreadCoutPct: +spreadCoutPct.toFixed(2),
    message: ok
      ? `Spread ${spreadCoutPct.toFixed(2)} % du profit — acceptable`
      : `Spread ${spreadCoutPct.toFixed(2)} % du profit — trop élevé (seuil ${seuilPct * 100} %)`
  };
}

/**
 * Corrélation entre paires : évite les positions doubles sur paires corrélées.
 *
 * @param {string} pair1 - Première paire (ex: 'EURUSD')
 * @param {string} pair2 - Deuxième paire (ex: 'GBPUSD')
 * @returns {boolean} true si les paires sont corrélées (> 70%)
 */
function pairesCorrelees(pair1, pair2) {
  if (!pair1 || !pair2) return false;
  const p1 = pair1.toUpperCase();
  const p2 = pair2.toUpperCase();
  if (p1 === p2) return true;

  // Paires fortement corrélées (corrélation > 70% sur les dernières années)
  const correlations = [
    ['EURUSD', 'GBPUSD'], ['EURUSD', 'AUDUSD'], ['EURUSD', 'NZDUSD'],
    ['GBPUSD', 'AUDUSD'], ['GBPUSD', 'NZDUSD'], ['AUDUSD', 'NZDUSD'],
    ['XAUUSD', 'XAGUSD'], ['BTCUSD', 'ETHUSD'], ['BTCUSD', 'SOLUSD'],
    ['US30', 'NAS100'], ['US30', 'SPX500'], ['NAS100', 'SPX500']
  ];

  return correlations.some(([a, b]) =>
    (p1.includes(a) && p2.includes(b)) || (p1.includes(b) && p2.includes(a))
  );
}

/**
 * Backtesting : valider une stratégie sur données historiques.
 *
 * Simule l'exécution d'une stratégie sur un historique de bougies et
 * calcule les statistiques de performance.
 *
 * @param {object} params
 * @param {Array} params.candles - Bougies OHLCV historiques
 * @param {Function} params.signalFn - Fonction qui prend des bougies et retourne { action: 'BUY'|'SELL'|null, entry: number, sl: number, tp: number }
 * @param {number} [params.riskPct] - Risque en % du capital par trade (défaut: 1)
 * @param {number} [params.initialCapital] - Capital initial (défaut: 10000)
 * @returns {object} Statistiques de performance
 */
function backtest({ candles, signalFn, riskPct = 1, initialCapital = 10000 }) {
  if (!candles || candles.length < 20) throw new Error('Pas assez de bougies pour backtester');
  if (!signalFn) throw new Error('signalFn est requis');

  let capital = initialCapital;
  let position = null;
  const trades = [];

  for (let i = 20; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const signal = signalFn(slice);

    // Gestion de la position ouverte
    if (position) {
      const c = candles[i];
      // Stop loss
      if ((position.direction === 'BUY' && c.l <= position.sl) ||
          (position.direction === 'SELL' && c.h >= position.sl)) {
        const pnl = position.direction === 'BUY'
          ? (position.sl - position.entry) * position.size
          : (position.entry - position.sl) * position.size;
        capital += pnl;
        trades.push({ ...position, exit: position.sl, pnl, result: pnl > 0 ? 'win' : 'loss', closedAt: c.t });
        position = null;
      }
      // Take profit
      else if ((position.direction === 'BUY' && c.h >= position.tp) ||
               (position.direction === 'SELL' && c.l <= position.tp)) {
        const pnl = position.direction === 'BUY'
          ? (position.tp - position.entry) * position.size
          : (position.entry - position.tp) * position.size;
        capital += pnl;
        trades.push({ ...position, exit: position.tp, pnl, result: 'win', closedAt: c.t });
        position = null;
      }
    }

    // Nouvelle position
    if (!position && signal && signal.action) {
      const stopDist = Math.abs(signal.entry - signal.sl);
      if (stopDist > 0) {
        const size = (capital * riskPct / 100) / stopDist;
        position = {
          direction: signal.action,
          entry: signal.entry,
          sl: signal.sl,
          tp: signal.tp,
          size,
          openedAt: candles[i].t
        };
      }
    }
  }

  // Clôturer la position ouverte à la dernière bougie
  if (position) {
    const last = candles[candles.length - 1];
    const pnl = position.direction === 'BUY'
      ? (last.c - position.entry) * position.size
      : (position.entry - last.c) * position.size;
    capital += pnl;
    trades.push({ ...position, exit: last.c, pnl, result: pnl > 0 ? 'win' : 'loss', closedAt: last.t });
  }

  const stats = computeStats(trades);
  return {
    ...stats,
    capitalFinal: +capital.toFixed(2),
    rendementPct: +((capital - initialCapital) / initialCapital * 100).toFixed(2),
    initialCapital
  };
}

module.exports = { normalize, close, computeStats, num, positionSizing, filtreSpread, pairesCorrelees, backtest };
