/**
 * 5trade — indicateurs techniques.
 *
 * RSI, MACD, moyennes mobiles, Bollinger Bands, Stochastic, VWAP.
 * Toutes les fonctions sont pures : entrée = bougies, sortie = données chiffrées.
 */

/**
 * RSI — Relative Strength Index.
 *
 * Mesure la vitesse et l'ampleur des mouvements de prix.
 * RSI > 70 = surachat, RSI < 30 = survente.
 *
 * @param {Array} candles - Bougies OHLCV
 * @param {number} period - Période (défaut: 14)
 * @returns {Array<number>} Valeurs RSI pour chaque bougie
 */
function rsi(candles, period = 14) {
  if (candles.length < period + 1) return [];

  const out = [];
  let avgGain = 0, avgLoss = 0;

  // Calcul initial : moyenne des gains/pertes sur la période
  for (let i = 1; i <= period; i++) {
    const change = candles[i].c - candles[i - 1].c;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  out.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));

  // Lissage de Wilder pour les bougies suivantes
  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].c - candles[i - 1].c;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    out.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
  }

  return out.map(v => +v.toFixed(2));
}

/**
 * MACD — Moving Average Convergence Divergence.
 *
 * MACD = EMA(12) - EMA(26)
 * Signal = EMA(9) du MACD
 * Histogramme = MACD - Signal
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {{ macd: Array<number>, signal: Array<number>, histogram: Array<number> }}
 */
function macd(candles) {
  if (candles.length < 26) return { macd: [], signal: [], histogram: [] };

  const ema12 = ema(candles, 12);
  const ema26 = ema(candles, 26);

  const macdLine = [];
  for (let i = 0; i < ema26.length; i++) {
    if (ema12[i] !== undefined && ema26[i] !== undefined) {
      macdLine.push(+(ema12[i] - ema26[i]).toFixed(6));
    }
  }

  // Signal = EMA(9) du MACD
  const signalLine = emaFromValues(macdLine, 9);

  const histogram = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (signalLine[i] !== undefined) {
      histogram.push(+(macdLine[i] - signalLine[i]).toFixed(6));
    }
  }

  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * Moyenne mobile simple (SMA).
 *
 * @param {Array} candles - Bougies OHLCV
 * @param {number} period - Période
 * @returns {Array<number>} Valeurs SMA
 */
function sma(candles, period) {
  const out = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].c;
    out.push(+(sum / period).toFixed(6));
  }
  return out;
}

/**
 * Moyenne mobile exponentielle (EMA).
 *
 * @param {Array} candles - Bougies OHLCV
 * @param {number} period - Période
 * @returns {Array<number>} Valeurs EMA
 */
function ema(candles, period) {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];

  // Amorce : SMA des `period` premières bougies
  let sum = 0;
  for (let i = 0; i < period; i++) sum += candles[i].c;
  let prev = sum / period;
  out.push(+prev.toFixed(6));

  for (let i = period; i < candles.length; i++) {
    prev = candles[i].c * k + prev * (1 - k);
    out.push(+prev.toFixed(6));
  }
  return out;
}

/**
 * EMA à partir de valeurs (pas de bougies).
 */
function emaFromValues(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];

  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out.push(+prev.toFixed(6));

  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(+prev.toFixed(6));
  }
  return out;
}

/**
 * Bollinger Bands.
 *
 * Bande moyenne = SMA(20)
 * Bande supérieure = SMA + 2 × écart-type
 * Bande inférieure = SMA - 2 × écart-type
 *
 * @param {Array} candles - Bougies OHLCV
 * @param {number} period - Période (défaut: 20)
 * @param {number} nbStd - Nombre d'écarts-types (défaut: 2)
 * @returns {{ middle: Array<number>, upper: Array<number>, lower: Array<number> }}
 */
function bollinger(candles, period = 20, nbStd = 2) {
  const middle = sma(candles, period);
  const upper = [];
  const lower = [];

  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1).map(c => c.c);
    const mean = middle[i - period + 1];
    const variance = slice.reduce((a, x) => a + (x - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    upper.push(+(mean + nbStd * std).toFixed(6));
    lower.push(+(mean - nbStd * std).toFixed(6));
  }

  return { middle, upper, lower };
}

/**
 * Stochastic Oscillator.
 *
 * %K = (C - L14) / (H14 - L14) × 100
 * %D = SMA(3) de %K
 *
 * @param {Array} candles - Bougies OHLCV
 * @param {number} period - Période (défaut: 14)
 * @returns {{ k: Array<number>, d: Array<number> }}
 */
function stochastic(candles, period = 14) {
  const kValues = [];

  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    const high = Math.max(...slice.map(c => c.h));
    const low = Math.min(...slice.map(c => c.l));
    const close = candles[i].c;
    const range = high - low;
    kValues.push(range === 0 ? 50 : +((close - low) / range * 100).toFixed(2));
  }

  // %D = SMA(3) de %K
  const dValues = [];
  for (let i = 2; i < kValues.length; i++) {
    dValues.push(+((kValues[i] + kValues[i - 1] + kValues[i - 2]) / 3).toFixed(2));
  }

  return { k: kValues, d: dValues };
}

/**
 * VWAP — Volume Weighted Average Price.
 *
 * VWAP = Σ(prix × volume) / Σ(volume)
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {number} VWAP
 */
function vwap(candles) {
  if (!candles.length) return 0;
  let pvSum = 0, vSum = 0;
  for (const c of candles) {
    const typicalPrice = (c.h + c.l + c.c) / 3;
    pvSum += typicalPrice * (c.v || 0);
    vSum += c.v || 0;
  }
  return vSum === 0 ? 0 : +(pvSum / vSum).toFixed(6);
}

module.exports = { rsi, macd, sma, ema, bollinger, stochastic, vwap };
