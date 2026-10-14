/**
 * 5trade — reconnaissance de patterns.
 *
 * Détecte les patterns de chandeliers et de graphiques :
 *   • Patterns de chandeliers : engulfing, hammer, shooting star, doji
 *   • Patterns de graphique : head and shoulders, double top/bottom, triangles
 *   • Patterns de continuation : flags, pennants
 */

/**
 * Détecte les patterns de chandeliers.
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<{ type: string, nom: string, direction: 'BUY'|'SELL', force: number, detail: string }>}
 */
function patternsChandeliers(candles) {
  if (!candles || candles.length < 3) return [];

  const patterns = [];
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];

  // Engulfing haussier
  if (prev.c < prev.o && last.c > last.o && last.c > prev.o && last.o < prev.c) {
    patterns.push({
      type: 'engulfing_haussier',
      nom: 'Engulfing haussier',
      direction: 'BUY',
      force: 0.7,
      detail: `bougie haussière qui englobe la bougie baissière précédente`
    });
  }

  // Engulfing baissier
  if (prev.c > prev.o && last.c < last.o && last.c < prev.o && last.o > prev.c) {
    patterns.push({
      type: 'engulfing_baissier',
      nom: 'Engulfing baissier',
      direction: 'SELL',
      force: 0.7,
      detail: `bougie baissière qui englobe la bougie haussière précédente`
    });
  }

  // Hammer
  const body = Math.abs(last.c - last.o);
  const lowerWick = Math.min(last.o, last.c) - last.l;
  const upperWick = last.h - Math.max(last.o, last.c);
  if (lowerWick > body * 2 && upperWick < body * 0.5) {
    patterns.push({
      type: 'hammer',
      nom: 'Hammer',
      direction: 'BUY',
      force: 0.6,
      detail: `mèche basse longue (${lowerWick.toFixed(2)}) et petit corps (${body.toFixed(2)})`
    });
  }

  // Shooting star
  if (upperWick > body * 2 && lowerWick < body * 0.5) {
    patterns.push({
      type: 'shooting_star',
      nom: 'Shooting star',
      direction: 'SELL',
      force: 0.6,
      detail: `mèche haute longue (${upperWick.toFixed(2)}) et petit corps (${body.toFixed(2)})`
    });
  }

  // Doji
  if (body < (last.h - last.l) * 0.1) {
    patterns.push({
      type: 'doji',
      nom: 'Doji',
      direction: 'NEUTRE',
      force: 0.3,
      detail: `corps très petit (${body.toFixed(2)}) — indécision`
    });
  }

  // Morning star
  if (prev2.c < prev2.o && prev.c < prev.o && Math.abs(prev.c - prev.o) < Math.abs(prev2.c - prev2.o) * 0.3 && last.c > last.o && last.c > (prev2.o + prev2.c) / 2) {
    patterns.push({
      type: 'morning_star',
      nom: 'Morning star',
      direction: 'BUY',
      force: 0.8,
      detail: `trois bougies : baissière, petite, haussière — retournement haussier`
    });
  }

  // Evening star
  if (prev2.c > prev2.o && prev.c > prev.o && Math.abs(prev.c - prev.o) < Math.abs(prev2.c - prev2.o) * 0.3 && last.c < last.o && last.c < (prev2.o + prev2.c) / 2) {
    patterns.push({
      type: 'evening_star',
      nom: 'Evening star',
      direction: 'SELL',
      force: 0.8,
      detail: `trois bougies : haussière, petite, baissière — retournement baissier`
    });
  }

  return patterns;
}

/**
 * Détecte les patterns de graphique.
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<{ type: string, nom: string, direction: 'BUY'|'SELL', force: number, detail: string }>}
 */
function patternsGraphique(candles) {
  if (!candles || candles.length < 20) return [];

  const patterns = [];
  const highs = candles.map(c => c.h);
  const lows = candles.map(c => c.l);

  // Double top
  const maxHigh = Math.max(...highs);
  const maxIndex = highs.indexOf(maxHigh);
  const secondMax = Math.max(...highs.filter((h, i) => i !== maxIndex && Math.abs(h - maxHigh) / maxHigh < 0.01));
  if (secondMax && Math.abs(secondMax - maxHigh) / maxHigh < 0.005) {
    patterns.push({
      type: 'double_top',
      nom: 'Double top',
      direction: 'SELL',
      force: 0.7,
      detail: `deux sommets à ${maxHigh.toFixed(2)} — résistance testée deux fois`
    });
  }

  // Double bottom
  const minLow = Math.min(...lows);
  const minIndex = lows.indexOf(minLow);
  const secondMin = Math.min(...lows.filter((l, i) => i !== minIndex && Math.abs(l - minLow) / minLow < 0.01));
  if (secondMin && Math.abs(secondMin - minLow) / minLow < 0.005) {
    patterns.push({
      type: 'double_bottom',
      nom: 'Double bottom',
      direction: 'BUY',
      force: 0.7,
      detail: `deux creux à ${minLow.toFixed(2)} — support testé deux fois`
    });
  }

  // Head and shoulders (simplifié)
  if (candles.length >= 30) {
    const leftShoulder = Math.max(...highs.slice(0, 10));
    const head = Math.max(...highs.slice(10, 20));
    const rightShoulder = Math.max(...highs.slice(20, 30));
    if (head > leftShoulder && head > rightShoulder && Math.abs(leftShoulder - rightShoulder) / leftShoulder < 0.02) {
      patterns.push({
        type: 'head_and_shoulders',
        nom: 'Head and shoulders',
        direction: 'SELL',
        force: 0.8,
        detail: `épaule gauche ${leftShoulder.toFixed(2)}, tête ${head.toFixed(2)}, épaule droite ${rightShoulder.toFixed(2)}`
      });
    }
  }

  // Triangle ascendant
  if (candles.length >= 20) {
    const recentHighs = highs.slice(-10);
    const recentLows = lows.slice(-10);
    const highFlat = Math.max(...recentHighs) - Math.min(...recentHighs) < (Math.max(...recentHighs) - Math.min(...recentLows)) * 0.1;
    const lowRising = recentLows[recentLows.length - 1] > recentLows[0];
    if (highFlat && lowRising) {
      patterns.push({
        type: 'triangle_ascendant',
        nom: 'Triangle ascendant',
        direction: 'BUY',
        force: 0.6,
        detail: `sommets plats et creux croissants — breakout haussier probable`
      });
    }
  }

  // Triangle descendant
  if (candles.length >= 20) {
    const recentHighs = highs.slice(-10);
    const recentLows = lows.slice(-10);
    const lowFlat = Math.max(...recentLows) - Math.min(...recentLows) < (Math.max(...recentHighs) - Math.min(...recentLows)) * 0.1;
    const highFalling = recentHighs[recentHighs.length - 1] < recentHighs[0];
    if (lowFlat && highFalling) {
      patterns.push({
        type: 'triangle_descendant',
        nom: 'Triangle descendant',
        direction: 'SELL',
        force: 0.6,
        detail: `creux plats et sommets décroissants — breakout baissier probable`
      });
    }
  }

  return patterns;
}

/**
 * Détecte les patterns de continuation.
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<{ type: string, nom: string, direction: 'BUY'|'SELL', force: number, detail: string }>}
 */
function patternsContinuation(candles) {
  if (!candles || candles.length < 15) return [];

  const patterns = [];

  // Flag haussier
  const firstHalf = candles.slice(0, Math.floor(candles.length / 2));
  const secondHalf = candles.slice(Math.floor(candles.length / 2));
  const firstTrend = firstHalf[firstHalf.length - 1].c - firstHalf[0].c;
  const secondTrend = secondHalf[secondHalf.length - 1].c - secondHalf[0].c;

  if (firstTrend > 0 && secondTrend < 0 && Math.abs(secondTrend) < Math.abs(firstTrend) * 0.5) {
    patterns.push({
      type: 'flag_haussier',
      nom: 'Flag haussier',
      direction: 'BUY',
      force: 0.6,
      detail: `impulsion haussière suivie d'une correction baissière — continuation probable`
    });
  }

  if (firstTrend < 0 && secondTrend > 0 && Math.abs(secondTrend) < Math.abs(firstTrend) * 0.5) {
    patterns.push({
      type: 'flag_baissier',
      nom: 'Flag baissier',
      direction: 'SELL',
      force: 0.6,
      detail: `impulsion baissière suivie d'une correction haussière — continuation probable`
    });
  }

  return patterns;
}

/**
 * Détecte tous les patterns.
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<{ type: string, nom: string, direction: 'BUY'|'SELL', force: number, detail: string }>}
 */
function detecterPatterns(candles) {
  return [
    ...patternsChandeliers(candles),
    ...patternsGraphique(candles),
    ...patternsContinuation(candles)
  ];
}

module.exports = { patternsChandeliers, patternsGraphique, patternsContinuation, detecterPatterns };
