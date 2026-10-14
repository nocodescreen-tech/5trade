/**
 * 5trade — backtesting visuel.
 *
 * Génère les données nécessaires pour afficher un backtesting interactif :
 *   • Courbe de equity
 *   • Drawdown
 *   • Trades (entrée/sortie)
 *   • Statistiques de performance
 */

const { backtest } = require('./trades');
const { calculerDrawdown } = require('./drawdownProtection');

/**
 * Exécute un backtesting et formate les résultats pour l'affichage.
 *
 * @param {object} params
 * @param {Array} params.candles - Bougies OHLCV
 * @param {Function} params.signalFn - Fonction de signal
 * @param {number} [params.riskPct] - Risque en % par trade
 * @param {number} [params.initialCapital] - Capital initial
 * @returns {object} Résultats formatés pour l'affichage
 */
function backtestVisuel({ candles, signalFn, riskPct = 1, initialCapital = 10000 }) {
  const result = backtest({ candles, signalFn, riskPct, initialCapital });

  // Formater la courbe de equity pour l'affichage
  const equityCurve = result.equityCurve || [];

  // Calculer le drawdown à chaque point
  const drawdownCurve = [];
  let peak = 0;
  for (const point of equityCurve) {
    if (point.value > peak) peak = point.value;
    const dd = peak > 0 ? ((peak - point.value) / peak) * 100 : 0;
    drawdownCurve.push({ t: point.t, value: +dd.toFixed(2) });
  }

  // Identifier les trades gagnants/perdants pour l'affichage
  const trades = (result.trades || []).map(t => ({
    id: t.id,
    direction: t.direction,
    entry: t.entry,
    exit: t.exit,
    pnl: t.pnl,
    result: t.result,
    openedAt: t.openedAt,
    closedAt: t.closedAt
  }));

  // Calculer les statistiques de performance
  const wins = trades.filter(t => t.result === 'win');
  const losses = trades.filter(t => t.result === 'loss');

  const avgWin = wins.length ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, t) => a + t.pnl, 0) / losses.length : 0;
  const profitFactor = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;

  // Série de trades consécutifs
  let maxWins = 0, maxLosses = 0, currentWins = 0, currentLosses = 0;
  for (const t of trades) {
    if (t.result === 'win') {
      currentWins++;
      currentLosses = 0;
      if (currentWins > maxWins) maxWins = currentWins;
    } else if (t.result === 'loss') {
      currentLosses++;
      currentWins = 0;
      if (currentLosses > maxLosses) maxLosses = currentLosses;
    }
  }

  return {
    equityCurve,
    drawdownCurve,
    trades,
    stats: {
      totalTrades: trades.length,
      winRate: result.winRate,
      pnlTotal: result.pnlTotal,
      rendementPct: result.rendementPct,
      capitalFinal: result.capitalFinal,
      profitFactor: +profitFactor.toFixed(2),
      avgWin: +avgWin.toFixed(2),
      avgLoss: +avgLoss.toFixed(2),
      maxWinsConsecutifs: maxWins,
      maxLossesConsecutifs: maxLosses,
      maxDrawdownPct: result.maxDrawdownPct || 0
    }
  };
}

module.exports = { backtestVisuel };
