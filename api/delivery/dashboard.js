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

const { risqueTotal, risqueParDevise } = require('../risk/portfolioRisk');
const { calculerDrawdown, courbeEquity } = require('../risk/drawdownProtection');
const { getCalendar } = require('../sources/fundamentals');
const Risque = require('../risk/risque');

// Un « gagné » et un « perdu » doivent vouloir dire la même chose partout dans
// le dépôt, qu'on parle d'un trade saisi à la main (result: win/loss) ou d'un
// signal du journal (resultat: tp1/tp2/sl). BE et expirations ne sont ni l'un ni
// l'autre : les compter au dénominateur sous-estimait le taux de réussite.
const GAGNES = new Set(['tp1', 'tp2', 'win']);
const PERDUS = new Set(['sl', 'loss', 'stop']);
const issueDe = t => String((t && (t.result || t.resultat || t.issue)) || '').toLowerCase();

/**
 * Construit le dashboard complet.
 *
 * @param {object} params
 * @param {Array} params.trades - Tous les trades
 * @param {Array} params.signals - Signaux récents
 * @param {number} [params.capital] - Capital du compte (défaut : data/risque.json)
 * @param {object} [params.prixParSymbole] - { PAIR: dernierPrix } pour le PnL courant
 * @returns {Promise<object>} Dashboard complet
 */
async function buildDashboard({ trades, signals = [], capital = null, prixParSymbole = {} }) {
  // Le capital par défaut était 10 000 en dur alors que data/risque.json dit
  // 1 000 : tout le dashboard (risque %, exposition) était donc 10× trop grand.
  const cap = Number.isFinite(Number(capital)) && Number(capital) > 0
    ? Number(capital)
    : Risque.configuration().capital;

  const openPositions = trades.filter(t => t.status === 'open');
  const closedTrades = trades.filter(t => t.status === 'closed');

  // PnL des positions ouvertes. Il valait 0 en dur : l'écran affichait « à
  // l'équilibre » sur toutes les positions. Sans prix courant, on rend null avec
  // son motif — un zéro inventé est un mensonge, pas une valeur par défaut.
  const positionsAvecPnL = openPositions.map(t => {
    const prix = Number(prixParSymbole[t.pair]);
    const entree = Number(t.entry);
    const taille = Number(t.size);
    const sens = t.direction === 'BUY' ? 1 : t.direction === 'SELL' ? -1 : 0;
    const calculable = Number.isFinite(prix) && sens !== 0 && Number.isFinite(entree) && Number.isFinite(taille) && taille > 0;
    return {
      ...t,
      prixActuel: Number.isFinite(prix) ? prix : null,
      pnlActuel: calculable ? +(((prix - entree) * sens * taille)).toFixed(2) : null,
      pnlMotif: calculable ? null : 'prix courant, sens ou taille indisponible — PnL non calculé',
      // PnL en devise de cotation (prix × taille), pas en euros : on ne convertit
      // pas sans taux de change sous la main.
      risquePct: Number.isFinite(Number(t.risk)) && Number.isFinite(taille) && taille > 0
        ? +((Number(t.risk) * taille / cap) * 100).toFixed(2) : null
    };
  });

  // Risque de portefeuille
  const risque = risqueTotal(openPositions, cap);
  const risqueDevises = risqueParDevise(openPositions, cap);

  // Drawdown
  const equityCurve = courbeEquity(closedTrades, cap);
  const drawdown = calculerDrawdown(equityCurve);

  // Calendrier économique (prochaines 24h)
  const calendar = await getCalendar();
  const newsHighImpact = calendar.filter(e => e.impact === 'high');

  // Stats rapides
  const gagnes = closedTrades.filter(t => GAGNES.has(issueDe(t)));
  const perdus = closedTrades.filter(t => PERDUS.has(issueDe(t)));
  const decides = gagnes.length + perdus.length;
  const rTotal = closedTrades.reduce((a, t) => a + (Number.isFinite(Number(t.r)) ? Number(t.r) : 0), 0);
  const pnlConnus = closedTrades.filter(t => Number.isFinite(Number(t.pnl)));
  const stats = {
    total: trades.length,
    open: openPositions.length,
    closed: closedTrades.length,
    wins: gagnes.length,
    losses: perdus.length,
    sansVerdict: closedTrades.length - decides,
    winRate: decides ? +((gagnes.length / decides) * 100).toFixed(1) : null,
    // pnlTotal ne sommes que ce qui existe : un trade sans pnl n'est pas un 0.
    pnlTotal: pnlConnus.length ? +pnlConnus.reduce((a, t) => a + Number(t.pnl), 0).toFixed(2) : null,
    pnlConnus: pnlConnus.length,
    rTotal: +rTotal.toFixed(3)
  };

  return {
    timestamp: new Date().toISOString(),
    capital: cap,
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
