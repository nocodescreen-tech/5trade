/**
 * 5trade — dashboard temps réel.
 *
 * Agrège les données de toutes les sources pour une vue d'ensemble :
 *   • Positions ouvertes avec PnL en temps réel
 *   • Signaux récents
 *   • Calendrier économique
 *   • Risque de portefeuille
 *   • Drawdown actuel
 *   • Courbe de equity
 */

const { risqueTotal, risqueParDevise } = require('./portfolioRisk');
const { calculerDrawdown, courbeEquity } = require('./drawdownProtection');
const { getCalendar } = require('./fundamentals');

/**
 * Construit le dashboard complet.
 *
 * @param {object} params
 * @param {Array} params.trades - Tous les trades
 * @param {Array} params.signals - Signaux récents
 * @param {number} params.capital - Capital du compte
 * @returns {Promise<object>} Dashboard complet
 */
async function buildDashboard({ trades, signals = [], capital = 10000 }) {
  const openPositions = trades.filter(t => t.status === 'open');
  const closedTrades = trades.filter(t => t.status === 'closed');

  // PnL des positions ouvertes (en supposant le prix actuel = entry pour l'instant)
  const positionsAvecPnL = openPositions.map(t => ({
    ...t,
    pnlActuel: 0, // serait calculé avec le prix actuel
    risquePct: t.risk && t.size ? (t.risk * t.size / capital) * 100 : 0
  }));

  // Risque de portefeuille
  const risque = risqueTotal(openPositions, capital);
  const risqueDevises = risqueParDevise(openPositions, capital);

  // Drawdown
  const equityCurve = courbeEquity(closedTrades, capital);
  const drawdown = calculerDrawdown(equityCurve);

  // Calendrier économique (prochaines 24h)
  const calendar = await getCalendar();
  const newsHighImpact = calendar.filter(e => e.impact === 'high');

  // Stats rapides
  const stats = {
    total: trades.length,
    open: openPositions.length,
    closed: closedTrades.length,
    wins: closedTrades.filter(t => t.result === 'win').length,
    losses: closedTrades.filter(t => t.result === 'loss').length,
    winRate: closedTrades.length
      ? +((closedTrades.filter(t => t.result === 'win').length / closedTrades.length) * 100).toFixed(1)
      : 0,
    pnlTotal: closedTrades.reduce((a, t) => a + (t.pnl || 0), 0)
  };

  return {
    timestamp: new Date().toISOString(),
    capital,
    positions: {
      ouvertes: positionsAvecPnL,
      risqueTotalPct: risque.risqueAjustePct,
      risqueParDevise: risqueDevises
    },
    drawdown: {
      actuel: drawdown.drawdownPct,
      max: drawdown.maxDrawdownPct,
      peak: drawdown.peak,
      current: drawdown.current
    },
    calendrier: {
      prochaines: newsHighImpact.slice(0, 5),
      totalHighImpact: newsHighImpact.length
    },
    signaux: signals.slice(0, 10),
    stats,
    equityCurve: equityCurve.slice(-100) // 100 derniers points
  };
}

module.exports = { buildDashboard };
