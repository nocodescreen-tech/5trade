/**
 * 5trade — corrélation dynamique entre paires.
 *
 * Calcule la corrélation glissante entre paires pour ajuster
 * le position sizing. Les corrélations changent avec le temps :
 * deux paires corrélées aujourd'hui ne le seront peut-être plus demain.
 */

/**
 * Calcule la corrélation glissante entre deux séries de prix.
 *
 * @param {Array} candles1 - Bougies de la première paire
 * @param {Array} candles2 - Bougies de la deuxième paire
 * @param {number} [period=20] - Période de la corrélation glissante
 * @returns {Array<number>} Valeurs de corrélation (-1 à +1)
 */
function correlationGlissante(candles1, candles2, period = 20) {
  if (!candles1 || !candles2) return [];

  // Synchronisation temporelle stricte par horodatage (time / t)
  const map2 = new Map();
  for (const c of candles2) {
    const t = c.time ?? c.t;
    if (t !== undefined) map2.set(t, c.c);
  }

  const pairesCommunes = [];
  for (const c of candles1) {
    const t = c.time ?? c.t;
    if (t !== undefined && map2.has(t)) {
      pairesCommunes.push({ c1: c.c, c2: map2.get(t) });
    }
  }

  // Fallback si pas de timestamps : alignement par index
  const paires = pairesCommunes.length >= period + 1
    ? pairesCommunes
    : Array.from({ length: Math.min(candles1.length, candles2.length) }, (_, i) => ({
        c1: candles1[i].c,
        c2: candles2[i].c
      }));

  const len = paires.length;
  if (len < period + 1) return [];

  const closes1 = paires.map(p => p.c1);
  const closes2 = paires.map(p => p.c2);
  const out = [];

  for (let i = period; i < len; i++) {
    const slice1 = closes1.slice(i - period, i + 1);
    const slice2 = closes2.slice(i - period, i + 1);
    out.push(+pearson(slice1, slice2).toFixed(4));
  }

  return out;
}

/**
 * Coefficient de corrélation de Pearson entre deux séries.
 */
function pearson(x, y) {
  const n = Math.min(x.length, y.length);
  // Série trop courte ou constante : la corrélation n'est pas MESURABLE. Rendre 0
  // faisait passer « on ne sait pas » pour « aucune corrélation » — deux
  // informations opposées que l'appelant ne pouvait plus distinguer.
  if (n < 2) return null;

  const sx = x.slice(0, n), sy = y.slice(0, n);
  const sumX = sx.reduce((a, b) => a + b, 0);
  const sumY = sy.reduce((a, b) => a + b, 0);
  const sumXY = sx.reduce((a, xi, i) => a + xi * sy[i], 0);
  const sumX2 = sx.reduce((a, b) => a + b * b, 0);
  const sumY2 = sy.reduce((a, b) => a + b * b, 0);

  const num = n * sumXY - sumX * sumY;
  const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  // Une série constante donne un déterminant nul, et une erreur d'arrondi peut
  // le rendre NÉGATIF : `Math.sqrt(-1e-12)` vaut NaN, qui se propageait ensuite
  // dans le position sizing sans que personne ne le voie. Tout ce qui n'est pas
  // strictement positif n'est pas mesurable.
  if (!(den > 0)) return null;
  return Math.max(-1, Math.min(1, num / den));
}

/**
 * Ajuste la taille de position selon la corrélation avec les positions
 * déjà ouvertes. Plus la corrélation est élevée, plus la taille est
 * réduite.
 *
 * @param {object} params
 * @param {number} params.tailleInitiale - Taille calculée par le position sizing
 * @param {Array} params.positionsExistantes - Positions ouvertes
 * @param {string} params.nouvellePaire - Nouvelle paire à ouvrir
 * @param {Array} [params.correlations] - Corrélations calculées
 * @returns {number} Taille ajustée
 */
function ajusterTailleParCorrelation({ tailleInitiale, positionsExistantes, nouvellePaire, correlations = null }) {
  if (!positionsExistantes || !positionsExistantes.length) return tailleInitiale;

  let maxCorrelation = 0;
  for (const pos of positionsExistantes) {
    if (correlations && correlations[pos.pair]) {
      maxCorrelation = Math.max(maxCorrelation, Math.abs(correlations[pos.pair] || 0));
    } else {
      // Approximation si pas de corrélation calculée
      if (pos.pair === nouvellePaire) {
        maxCorrelation = 1;
      }
    }
  }

  // Réduction proportionnelle à la corrélation
  const reduction = maxCorrelation * 0.5; // max 50 % de réduction
  return +(tailleInitiale * (1 - reduction)).toFixed(4);
}

/**
 * Détecte les ruptures de corrélation (changement brutal).
 *
 * @param {Array} correlations - Historique de corrélation
 * @param {number} [seuil=0.5] - Seuil de variation pour détecter une rupture
 * @returns {boolean} true si une rupture est détectée
 */
function ruptureCorrelation(correlations, seuil = 0.5) {
  if (!correlations || correlations.length < 10) return false;
  const last = correlations[correlations.length - 1];
  const prev = correlations[correlations.length - 10];
  return Math.abs(last - prev) > seuil;
}

module.exports = { correlationGlissante, pearson, ajusterTailleParCorrelation, ruptureCorrelation };
