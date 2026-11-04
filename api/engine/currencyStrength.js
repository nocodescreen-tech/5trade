/**
 * 5trade — force des devises.
 *
 * Calcule un indice de force pour chaque devise majeure en analysant
 * toutes les paires qui la contiennent. Une devise forte = elle monte
 * contre toutes les autres.
 *
 * Devises suivies : EUR, GBP, USD, JPY, AUD, CAD, CHF, NZD
 */

const DEVISES = ['EUR', 'GBP', 'USD', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'];

/**
 * Calcule la force de chaque devise à partir des variations récentes.
 *
 * @param {Object<string, Array>} parPaire - { 'EURUSD': [...bougies], ... }
 * @param {number} [lookback] - Nombre de bougies à analyser (défaut: 20)
 * @returns {Object<string, number>} Force par devise (-100 à +100)
 */
function forceDevises(parPaire, lookback = 20) {
  const forces = {};
  for (const d of DEVISES) forces[d] = 0;

  for (const [symbol, candles] of Object.entries(parPaire)) {
    if (!candles || candles.length < lookback + 1) continue;

    const devise1 = symbol.slice(0, 3).toUpperCase();
    const devise2 = symbol.slice(3, 6).toUpperCase();

    if (!forces.hasOwnProperty(devise1) || !forces.hasOwnProperty(devise2)) continue;

    // Variation récente en %
    const recent = candles.slice(-lookback - 1);
    const first = recent[0];
    const last = recent[recent.length - 1];
    const variationPct = ((last.c - first.c) / first.c) * 100;

    // La devise 1 gagne si le prix monte, la devise 2 gagne si le prix descend
    forces[devise1] += variationPct * 100;
    forces[devise2] -= variationPct * 100;
  }

  // Normaliser entre -100 et +100
  let maxAbs = 0;
  for (const d of DEVISES) {
    if (Math.abs(forces[d]) > maxAbs) maxAbs = Math.abs(forces[d]);
  }
  if (maxAbs > 0) {
    for (const d of DEVISES) {
      forces[d] = +((forces[d] / maxAbs) * 100).toFixed(1);
    }
  }

  return forces;
}

/**
 * Classe les devises par force (de la plus forte à la plus faible).
 *
 * @param {Object<string, number>} forces - Résultat de forceDevises()
 * @returns {Array<{ devise: string, force: number }>}
 */
function classeDevises(forces) {
  return Object.entries(forces)
    .map(([devise, force]) => ({ devise, force }))
    .sort((a, b) => b.force - a.force);
}

/**
 * Identifie la paire la plus forte (devise forte vs devise faible).
 *
 * @param {Object<string, number>} forces - Résultat de forceDevises()
 * @returns {Object|null} { paire: 'EURUSD', deviseForte: 'EUR', deviseFaible: 'USD' }
 */
function paireLaPlusForte(forces) {
  const classees = classeDevises(forces);
  if (classees.length < 2) return null;

  const forte = classees[0].devise;
  const faible = classees[classees.length - 1].devise;

  // Trouver la paire qui contient les deux
  const paire = DEVISES.includes(forte) && DEVISES.includes(faible)
    ? forte + faible
    : null;

  return paire ? {
    paire,
    deviseForte: forte,
    deviseFaible: faible,
    ecart: +(classees[0].force - classees[classees.length - 1].force).toFixed(1)
  } : null;
}

/**
 * Matrice de corrélation entre devises.
 *
 * @param {Object<string, number>} forces - Résultat de forceDevises()
 * @returns {Object} Matrice { EUR: { USD: 0.8, GBP: 0.3, ... }, ... }
 */
function matriceCorrelation(forces) {
  const matrice = {};
  for (const d1 of DEVISES) {
    matrice[d1] = {};
    for (const d2 of DEVISES) {
      if (d1 === d2) {
        matrice[d1][d2] = 1;
      } else {
        // Corrélation approximative basée sur la force relative
        const diff = forces[d1] - forces[d2];
        matrice[d1][d2] = +((1 - Math.abs(diff) / 200)).toFixed(2);
      }
    }
  }
  return matrice;
}

module.exports = { forceDevises, classeDevises, paireLaPlusForte, matriceCorrelation, DEVISES };
