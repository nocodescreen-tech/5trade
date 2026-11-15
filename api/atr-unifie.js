/**
 * 5trade — ATR unifié (Average True Range).
 *
 * AVANT : 5 implémentations différentes vivaient dans le code, avec des
 * résultats divergents pour le même instrument au même instant.
 *   - engine/structure.js        → lissage de Wilder (correct)
 *   - engine/signals.js          → moyenne simple (incorrect)
 *   - engine/plans.js            → moyenne simple (incorrect)
 *   - market-intelligence/regime-detector.js → moyenne simple (incorrect)
 *   - strategies/retour-moyenne.js → moyenne simple (incorrect)
 *
 * APRÈS : un seul calcul, la formule de Wilder (1978), « New Concepts in
 * Technical Trading Systems ». Tous les modules importent `atr` depuis ici.
 *
 *   Amorce : moyenne simple des n premiers True Range.
 *   Puis lissage exponentiel : ATR_t = (ATR_{t-1} × (n-1) + TR_t) / n
 *
 * Sortie : la valeur ATR courante (sur la dernière bougie close), en unités
 * de prix. Renvoie null si pas assez de bougies.
 *
 * Garde-fous :
 *   - candles doit être un tableau non vide d'objets {h, l, c}
 *   - period ≥ 1, sinon repli à 14
 *   - si une bougie a h/l/c absent ou non fini, on l'ignore (pas de NaN propagé)
 */

/**
 * True Range d'une bougie par rapport à la précédente.
 * @param {{h:number,l:number,c:number}} b   bougie courante
 * @param {{c:number}} p                      bougie précédente
 * @returns {number}
 */
function trueRange(b, p) {
  const hl = b.h - b.l;
  const hc = Math.abs(b.h - p.c);
  const lc = Math.abs(b.l - p.c);
  return Math.max(hl, hc, lc);
}

/**
 * @param {Array<{h:number,l:number,c:number}>} candles
 * @param {number} [period=14]
 * @returns {number|null} ATR courant, ou null si données insuffisantes
 */
function atr(candles, period = 14) {
  if (!Array.isArray(candles)) return null;
  const n = Math.max(1, Number(period) || 14);
  // On nettoie : ne garder que les bougies avec h, l, c finis.
  const clean = candles.filter(c =>
    c && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c));
  if (clean.length < n + 1) return null;  // +1 car le premier TR exige une précédente

  const trs = [];
  for (let i = 1; i < clean.length; i++) {
    trs.push(trueRange(clean[i], clean[i - 1]));
  }

  // Amorce : moyenne simple des n premiers TR (formule Wilder).
  let valeur = trs.slice(0, n).reduce((a, x) => a + x, 0) / n;
  // Lissage exponentiel sur le reste.
  for (let i = n; i < trs.length; i++) {
    valeur = (valeur * (n - 1) + trs[i]) / n;
  }
  return Number.isFinite(valeur) && valeur > 0 ? +valeur.toFixed(6) : null;
}

/**
 * Série ATR complète (pour le backtest : il faut la valeur à chaque bougie,
 * pas seulement la courante).
 * @returns {Array<number>} tableau de même longueur que candles, valeurs null
 *                          pour les bougies où l'ATR n'est pas encore calculable
 */
function atrSerie(candles, period = 14) {
  if (!Array.isArray(candles)) return [];
  const n = Math.max(1, Number(period) || 14);
  const clean = candles.map(c =>
    c && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c) ? c : null);
  const out = new Array(candles.length).fill(null);
  if (clean.length < n + 1) return out;

  const trs = [null];  // pas de TR sur la première bougie
  for (let i = 1; i < clean.length; i++) {
    if (clean[i] && clean[i - 1]) trs.push(trueRange(clean[i], clean[i - 1]));
    else trs.push(null);
  }

  // Amorce sur les bougies 1 à n
  const amorce = trs.slice(1, n + 1).filter(x => Number.isFinite(x));
  if (amorce.length < n) return out;
  let valeur = amorce.reduce((a, x) => a + x, 0) / n;
  out[n] = +valeur.toFixed(6);

  for (let i = n + 1; i < trs.length; i++) {
    if (!Number.isFinite(trs[i])) { out[i] = out[i - 1]; continue; }
    valeur = (valeur * (n - 1) + trs[i]) / n;
    out[i] = +valeur.toFixed(6);
  }
  return out;
}

module.exports = { atr, atrSerie, trueRange };
