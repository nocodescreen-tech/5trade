/**
 * 5trade — détection de divergences.
 *
 * Une divergence se produit lorsque le prix et un indicateur technique
 * ne vont pas dans le même sens. C'est un signal de retournement puissant.
 *
 * Types de divergences :
 *   • Divergence baissière : prix fait un haut plus haut, RSI fait un haut plus bas
 *   • Divergence haussière : prix fait un bas plus bas, RSI fait un bas plus haut
 *   • Divergence cachée baissière : prix fait un bas plus bas, RSI fait un bas plus haut (continuation)
 *   • Divergence cachée haussière : prix fait un haut plus haut, RSI fait un haut plus bas (continuation)
 */

const { rsi } = require('./indicators');

/**
 * Détecte les divergences entre le prix et le RSI.
 *
 * @param {Array} candles - Bougies OHLCV
 * @param {number} [lookback] - Nombre de bougies à analyser (défaut: 20)
 * @returns {Array<{ type: 'baissiere'|'haussiere'|'cachee_baissiere'|'cachee_haussiere', prix: number, rsi: number, force: number, detail: string }>}
 */
function detecterDivergences(candles, lookback = 20) {
  if (!candles || candles.length < lookback + 15) return [];

  const rsiValues = rsi(candles, 14);
  if (!rsiValues.length) return [];

  const divergences = [];
  const slice = candles.slice(-lookback);
  const rsiSlice = rsiValues.slice(-lookback);

  // Trouver les sommets et creux locaux
  const swings = [];
  for (let i = 2; i < slice.length - 2; i++) {
    // Sommet local
    if (slice[i].h > slice[i - 1].h && slice[i].h > slice[i - 2].h &&
        slice[i].h > slice[i + 1].h && slice[i].h > slice[i + 2].h) {
      swings.push({ type: 'high', index: i, prix: slice[i].h, rsi: rsiSlice[i] });
    }
    // Creux local
    if (slice[i].l < slice[i - 1].l && slice[i].l < slice[i - 2].l &&
        slice[i].l < slice[i + 1].l && slice[i].l < slice[i + 2].l) {
      swings.push({ type: 'low', index: i, prix: slice[i].l, rsi: rsiSlice[i] });
    }
  }

  // Comparer les sommets consécutifs
  const highs = swings.filter(s => s.type === 'high');
  for (let i = 1; i < highs.length; i++) {
    const prev = highs[i - 1];
    const cur = highs[i];

    // Divergence baissière : prix haut plus haut, RSI haut plus bas
    if (cur.prix > prev.prix && cur.rsi < prev.rsi) {
      const force = Math.min(((cur.prix - prev.prix) / prev.prix) * 10000, 100);
      divergences.push({
        type: 'baissiere',
        prix: cur.prix,
        rsi: cur.rsi,
        force: +force.toFixed(1),
        detail: `prix haut plus haut (${prev.prix.toFixed(2)} → ${cur.prix.toFixed(2)}), RSI haut plus bas (${prev.rsi.toFixed(1)} → ${cur.rsi.toFixed(1)})`
      });
    }

    // Divergence cachée haussière : prix haut plus haut, RSI haut plus haut (continuation)
    if (cur.prix > prev.prix && cur.rsi > prev.rsi) {
      const force = Math.min(((cur.prix - prev.prix) / prev.prix) * 10000, 100);
      divergences.push({
        type: 'cachee_haussiere',
        prix: cur.prix,
        rsi: cur.rsi,
        force: +force.toFixed(1),
        detail: `prix haut plus haut, RSI haut plus haut — continuation haussière`
      });
    }
  }

  // Comparer les creux consécutifs
  const lows = swings.filter(s => s.type === 'low');
  for (let i = 1; i < lows.length; i++) {
    const prev = lows[i - 1];
    const cur = lows[i];

    // Divergence haussière : prix bas plus bas, RSI bas plus haut
    if (cur.prix < prev.prix && cur.rsi > prev.rsi) {
      const force = Math.min(((prev.prix - cur.prix) / prev.prix) * 10000, 100);
      divergences.push({
        type: 'haussiere',
        prix: cur.prix,
        rsi: cur.rsi,
        force: +force.toFixed(1),
        detail: `prix bas plus bas (${prev.prix.toFixed(2)} → ${cur.prix.toFixed(2)}), RSI bas plus haut (${prev.rsi.toFixed(1)} → ${cur.rsi.toFixed(1)})`
      });
    }

    // Divergence cachée baissière : prix bas plus bas, RSI bas plus bas (continuation)
    if (cur.prix < prev.prix && cur.rsi < prev.rsi) {
      const force = Math.min(((prev.prix - cur.prix) / prev.prix) * 10000, 100);
      divergences.push({
        type: 'cachee_baissiere',
        prix: cur.prix,
        rsi: cur.rsi,
        force: +force.toFixed(1),
        detail: `prix bas plus bas, RSI bas plus bas — continuation baissière`
      });
    }
  }

  return divergences;
}

/**
 * Détecte les divergences entre le prix et le MACD.
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<{ type: string, prix: number, macd: number, detail: string }>}
 */
function detecterDivergencesMACD(candles) {
  const { macd: macdLine } = require('./indicators').macd(candles);
  if (!macdLine || macdLine.length < 20) return [];

  const divergences = [];
  const slice = candles.slice(-20);
  const macdSlice = macdLine.slice(-20);

  // Trouver les sommets et creux
  const swings = [];
  for (let i = 2; i < slice.length - 2; i++) {
    if (slice[i].h > slice[i - 1].h && slice[i].h > slice[i + 1].h) {
      swings.push({ type: 'high', index: i, prix: slice[i].h, macd: macdSlice[i] });
    }
    if (slice[i].l < slice[i - 1].l && slice[i].l < slice[i + 1].l) {
      swings.push({ type: 'low', index: i, prix: slice[i].l, macd: macdSlice[i] });
    }
  }

  // Divergences baissières
  const highs = swings.filter(s => s.type === 'high');
  for (let i = 1; i < highs.length; i++) {
    if (highs[i].prix > highs[i - 1].prix && highs[i].macd < highs[i - 1].macd) {
      divergences.push({
        type: 'baissiere',
        prix: highs[i].prix,
        macd: highs[i].macd,
        detail: 'prix haut plus haut, MACD haut plus bas'
      });
    }
  }

  // Divergences haussières
  const lows = swings.filter(s => s.type === 'low');
  for (let i = 1; i < lows.length; i++) {
    if (lows[i].prix < lows[i - 1].prix && lows[i].macd > lows[i - 1].macd) {
      divergences.push({
        type: 'haussiere',
        prix: lows[i].prix,
        macd: lows[i].macd,
        detail: 'prix bas plus bas, MACD bas plus haut'
      });
    }
  }

  return divergences;
}

module.exports = { detecterDivergences, detecterDivergencesMACD };
