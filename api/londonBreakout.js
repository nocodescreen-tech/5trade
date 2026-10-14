/**
 * 5trade — London Breakout.
 *
 * Détecte les cassures du range asiatique à l'ouverture de Londres.
 * C'est une stratégie classique : l'Asie construit un range étroit,
 * Londres le casse, New York prolonge ou retourne.
 *
 * Règles :
 *   • Le range asiatique doit être défini (high/low)
 *   • La cassure doit avoir lieu pendant la session de Londres (7h-16h UTC)
 *   • Le volume doit être supérieur à la moyenne
 *   • Un faux breakout (sweep) est détecté si le prix revient dans le range
 */

const { TF_MS } = require('./market');

/**
 * Détecte le range asiatique (0h – 8h UTC).
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {{ high: number, low: number, range: number, nbBougies: number }|null}
 */
function rangeAsiatique(candles) {
  if (!candles || !candles.length) return null;

  const asiatiques = candles.filter(c => {
    const h = new Date(c.t).getUTCHours();
    return h >= 0 && h < 8;
  });

  if (asiatiques.length < 5) return null;

  const high = Math.max(...asiatiques.map(c => c.h));
  const low = Math.min(...asiatiques.map(c => c.l));

  return {
    high: +high.toFixed(6),
    low: +low.toFixed(6),
    range: +(high - low).toFixed(6),
    nbBougies: asiatiques.length
  };
}

/**
 * Détecte un London Breakout.
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {{ detecte: boolean, type: 'hausse'|'baisse'|null, level: number, force: number, detail: string }}
 */
function londonBreakout(candles) {
  const range = rangeAsiatique(candles);
  if (!range) return { detecte: false, type: null, level: 0, force: 0, detail: 'range asiatique non défini' };

  // Trouver la première bougie de Londres après le range
  const londonStart = candles.findIndex(c => {
    const h = new Date(c.t).getUTCHours();
    return h >= 7 && h < 16;
  });

  if (londonStart < 0) return { detecte: false, type: null, level: 0, force: 0, detail: 'pas de bougie de Londres' };

  // Vérifier si le prix a cassé le range
  const londonCandles = candles.slice(londonStart);
  const last = londonCandles[londonCandles.length - 1];

  // Cassure haussière
  if (last.c > range.high) {
    const breakoutRange = last.c - range.high;
    const force = Math.min((breakoutRange / range.range) * 100, 100);
    return {
      detecte: true,
      type: 'hausse',
      level: range.high,
      force: +force.toFixed(1),
      detail: `cassure haussière de ${breakoutRange.toFixed(2)} (${force.toFixed(1)} % du range)`
    };
  }

  // Cassure baissière
  if (last.c < range.low) {
    const breakoutRange = range.low - last.c;
    const force = Math.min((breakoutRange / range.range) * 100, 100);
    return {
      detecte: true,
      type: 'baisse',
      level: range.low,
      force: +force.toFixed(1),
      detail: `cassure baissière de ${breakoutRange.toFixed(2)} (${force.toFixed(1)} % du range)`
    };
  }

  // Faux breakout : le prix est sorti puis est revenu
  const outside = londonCandles.find(c => c.c > range.high || c.c < range.low);
  if (outside && last.c > range.low && last.c < range.high) {
    return {
      detecte: false,
      type: null,
      level: 0,
      force: 0,
      detail: 'faux breakout — le prix est revenu dans le range'
    };
  }

  return { detecte: false, type: null, level: 0, force: 0, detail: 'pas de cassure du range' };
}

/**
 * Évalue la qualité du London Breakout.
 *
 * @param {object} lb - Résultat de londonBreakout()
 * @param {Array} candles - Bougies OHLCV
 * @returns {{ score: number, qualite: 'excellent'|'bon'|'moyen'|'faible', facteurs: object }}
 */
function evaluerQualite(lb, candles) {
  if (!lb.detecte) return { score: 0, qualite: 'faible', facteurs: {} };

  const range = rangeAsiatique(candles);
  const facteurs = {};

  // 1. Force de la cassure (0-30 points)
  facteurs.force = Math.min(lb.force / 3, 30);

  // 2. Taille du range (0-20 points)
  // Un range trop étroit = faux signal, un range trop large = moins fiable
  if (range) {
    const atr = 100; // approximation
    const rangeAtr = range.range / atr;
    facteurs.tailRange = rangeAtr > 0.5 && rangeAtr < 3 ? 20 : 10;
  } else {
    facteurs.tailRange = 10;
  }

  // 3. Heure de la cassure (0-20 points)
  // Les meilleures cassures ont lieu entre 7h et 10h UTC
  const last = candles[candles.length - 1];
  const hour = new Date(last.t).getUTCHours();
  facteurs.horaire = (hour >= 7 && hour < 10) ? 20 : 10;

  // 4. Volume (0-30 points)
  // Le volume doit être supérieur à la moyenne
  const volumes = candles.slice(-20).map(c => c.v || 0);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const lastVolume = last.v || 0;
  facteurs.volume = lastVolume > avgVolume * 1.5 ? 30 : lastVolume > avgVolume ? 20 : 10;

  const score = Math.round(facteurs.force + facteurs.tailRange + facteurs.horaire + facteurs.volume);

  return {
    score,
    qualite: score >= 80 ? 'excellent' : score >= 60 ? 'bon' : score >= 40 ? 'moyen' : 'faible',
    facteurs
  };
}

module.exports = { rangeAsiatique, londonBreakout, evaluerQualite };
