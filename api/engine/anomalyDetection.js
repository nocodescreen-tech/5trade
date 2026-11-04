/**
 * 5trade — détection d'anomalies.
 *
 * Détecte les mouvements de prix inhabituels qui peuvent indiquer :
 *   • Une nouvelle importante
 *   • Une manipulation de marché
 *   • Un changement de régime
 *   • Une opportunité de trading
 */

const { atr } = require('./structure');

/**
 * Détecte les anomalies de prix (mouvements inhabituels).
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<{ index: number, type: 'hausse'|'baisse', force: number, detail: string }>}
 */
function anomaliesPrix(candles) {
  if (!candles || candles.length < 20) return [];

  const anomalies = [];
  const a = atr(candles, 14);
  if (!a) return [];

  for (let i = 1; i < candles.length; i++) {
    const change = Math.abs(candles[i].c - candles[i - 1].c);
    const changePct = (change / candles[i - 1].c) * 100;

    // Anomaly si le mouvement dépasse 3× l'ATR
    if (change > a * 3) {
      const type = candles[i].c > candles[i - 1].c ? 'hausse' : 'baisse';
      anomalies.push({
        index: i,
        type,
        force: Math.min(change / a, 10),
        detail: `mouvement ${type} inhabituel : ${changePct.toFixed(2)} % (${(change / a).toFixed(1)}× ATR)`
      });
    }
  }

  return anomalies;
}

/**
 * Détecte les anomalies de volume.
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<{ index: number, force: number, detail: string }>}
 */
function anomaliesVolume(candles) {
  if (!candles || candles.length < 20) return [];

  const anomalies = [];
  const volumes = candles.map(c => c.v || 0);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const stdVolume = Math.sqrt(volumes.reduce((a, v) => a + (v - avgVolume) ** 2, 0) / volumes.length);

  for (let i = 0; i < candles.length; i++) {
    const v = candles[i].v || 0;
    if (v > avgVolume + 3 * stdVolume) {
      anomalies.push({
        index: i,
        force: Math.min(v / avgVolume, 10),
        detail: `volume anormal : ${v.toFixed(0)} (${(v / avgVolume).toFixed(1)}× la moyenne)`
      });
    }
  }

  return anomalies;
}

/**
 * Détecte les anomalies de volatilité.
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<{ index: number, type: 'augmentation'|'diminution', force: number, detail: string }>}
 */
function anomaliesVolatilite(candles) {
  if (!candles || candles.length < 30) return [];

  const anomalies = [];
  const atrValues = [];

  for (let i = 14; i < candles.length; i++) {
    const slice = candles.slice(i - 14, i + 1);
    const a = atr(slice, 14);
    if (a) atrValues.push(a);
  }

  if (atrValues.length < 10) return [];

  const avgAtr = atrValues.reduce((a, b) => a + b, 0) / atrValues.length;

  for (let i = 1; i < atrValues.length; i++) {
    const change = Math.abs(atrValues[i] - atrValues[i - 1]);
    const changePct = (change / atrValues[i - 1]) * 100;

    if (changePct > 50) {
      const type = atrValues[i] > atrValues[i - 1] ? 'augmentation' : 'diminution';
      anomalies.push({
        index: i,
        type,
        force: Math.min(changePct / 50, 10),
        detail: `volatilité ${type} : ATR ${atrValues[i - 1].toFixed(2)} → ${atrValues[i].toFixed(2)} (${changePct.toFixed(1)} %)`
      });
    }
  }

  return anomalies;
}

/**
 * Détecte les anomalies de spread (si disponible).
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<{ index: number, force: number, detail: string }>}
 */
function anomaliesSpread(candles) {
  if (!candles || candles.length < 20) return [];

  const anomalies = [];
  const spreads = candles.map(c => c.h - c.l);
  const avgSpread = spreads.reduce((a, b) => a + b, 0) / spreads.length;

  for (let i = 0; i < candles.length; i++) {
    const spread = spreads[i];
    if (spread > avgSpread * 3) {
      anomalies.push({
        index: i,
        force: Math.min(spread / avgSpread, 10),
        detail: `spread anormal : ${spread.toFixed(2)} (${(spread / avgSpread).toFixed(1)}× la moyenne)`
      });
    }
  }

  return anomalies;
}

/**
 * Analyse complète des anomalies.
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {object} Analyse complète
 */
function analyserAnomalies(candles) {
  return {
    prix: anomaliesPrix(candles),
    volume: anomaliesVolume(candles),
    volatilite: anomaliesVolatilite(candles),
    spread: anomaliesSpread(candles)
  };
}

module.exports = { anomaliesPrix, anomaliesVolume, anomaliesVolatilite, anomaliesSpread, analyserAnomalies };
