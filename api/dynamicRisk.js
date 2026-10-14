/**
 * 5trade — ajustement dynamique du risque.
 *
 * Adapte le risque en fonction de la volatilité du marché :
 *   • ATR élevé  → réduire le risque (marché instable)
 *   • ATR faible → augmenter le risque (marché calme)
 *   • ATR normal → risque normal
 *
 * L'ATR est comparé à sa moyenne historique pour déterminer
 * si la volatilité est élevée ou faible.
 */

const { atr } = require('./structure');

/**
 * Calcule le facteur d'ajustement du risque basé sur l'ATR.
 *
 * @param {Array} candles - Bougies OHLCV
 * @param {number} [atrPeriod] - Période de l'ATR (défaut: 14)
 * @param {number} [lookback] - Nombre de bougies pour la moyenne ATR (défaut: 50)
 * @returns {{ facteur: number, atrActuel: number, atrMoyen: number, ratio: number, detail: string }}
 */
function ajusterRisqueATR(candles, atrPeriod = 14, lookback = 50) {
  if (!candles || candles.length < lookback + atrPeriod) {
    return { facteur: 1, atrActuel: 0, atrMoyen: 0, ratio: 0, detail: 'pas assez de données' };
  }

  const atrActuel = atr(candles, atrPeriod);
  if (!atrActuel) return { facteur: 1, atrActuel: 0, atrMoyen: 0, ratio: 0, detail: 'ATR indisponible' };

  // Calculer la moyenne de l'ATR sur les dernières bougies
  const atrValues = [];
  for (let i = lookback; i < candles.length; i++) {
    const slice = candles.slice(i - atrPeriod - 1, i + 1);
    const a = atr(slice, atrPeriod);
    if (a) atrValues.push(a);
  }

  if (!atrValues.length) return { facteur: 1, atrActuel, atrMoyen: 0, ratio: 0, detail: 'moyenne ATR indisponible' };

  const atrMoyen = atrValues.reduce((a, b) => a + b, 0) / atrValues.length;
  const ratio = atrActuel / atrMoyen;

  // Facteur d'ajustement :
  //   ratio > 1.5 → risque × 0.5 (volatilité élevée)
  //   ratio > 1.2 → risque × 0.75
  //   ratio < 0.8 → risque × 1.25 (volatilité faible)
  //   ratio < 0.5 → risque × 1.5
  //   sinon → risque × 1.0
  let facteur = 1;
  if (ratio > 1.5) facteur = 0.5;
  else if (ratio > 1.2) facteur = 0.75;
  else if (ratio < 0.5) facteur = 1.5;
  else if (ratio < 0.8) facteur = 1.25;

  return {
    facteur,
    atrActuel: +atrActuel.toFixed(6),
    atrMoyen: +atrMoyen.toFixed(6),
    ratio: +ratio.toFixed(3),
    detail: `ATR ${atrActuel.toFixed(2)} vs moyenne ${atrMoyen.toFixed(2)} (ratio ${ratio.toFixed(2)}) → risque × ${facteur}`
  };
}

/**
 * Calcule le risque ajusté en fonction de la volatilité.
 *
 * @param {number} risqueNormal - Risque normal en %
 * @param {number} facteur - Facteur d'ajustement (0.5 à 1.5)
 * @returns {number} Risque ajusté en %
 */
function risqueAjuste(risqueNormal, facteur) {
  return +(risqueNormal * facteur).toFixed(3);
}

/**
 * Détermine si les conditions de marché sont favorables au trading.
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {{ favorable: boolean, score: number, facteurs: object }}
 */
function conditionsFavorables(candles) {
  if (!candles || candles.length < 50) {
    return { favorable: false, score: 0, facteurs: {} };
  }

  const facteurs = {};

  // 1. Volatilité (0-30 points)
  const atrActuel = atr(candles, 14);
  const prix = candles[candles.length - 1].c;
  const atrPct = prix ? (atrActuel / prix) * 100 : 0;
  facteurs.volatilite = atrPct > 0.05 && atrPct < 0.5 ? 30 : atrPct > 0.02 ? 20 : 10;

  // 2. Tendance (0-30 points)
  const sma20 = candles.slice(-20).reduce((a, c) => a + c.c, 0) / 20;
  const sma50 = candles.slice(-50).reduce((a, c) => a + c.c, 0) / 50;
  const trend = sma20 > sma50 ? 'haussiere' : sma20 < sma50 ? 'baissiere' : 'range';
  facteurs.tendance = trend !== 'range' ? 30 : 15;

  // 3. Volume (0-20 points)
  const volumes = candles.slice(-20).map(c => c.v || 0);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const lastVolume = candles[candles.length - 1].v || 0;
  facteurs.volume = lastVolume > avgVolume ? 20 : 10;

  // 4. Session (0-20 points)
  const hour = new Date(candles[candles.length - 1].t).getUTCHours();
  facteurs.session = (hour >= 7 && hour < 16) ? 20 : 10;

  const score = facteurs.volatilite + facteurs.tendance + facteurs.volume + facteurs.session;

  return {
    favorable: score >= 60,
    score,
    facteurs
  };
}

module.exports = { ajusterRisqueATR, risqueAjuste, conditionsFavorables };
