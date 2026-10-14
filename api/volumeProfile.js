/**
 * 5trade — volume profile.
 *
 * Analyse le volume par niveau de prix pour identifier :
 *   • POC (Point of Control) — niveau avec le plus de volume
 *   • Value Area (VAH, VAL) — zone contenant 70 % du volume
 *   • Niveaux de volume élevé/faible — support/résistance
 */

/**
 * Calcule le volume profile sur une plage de prix.
 *
 * @param {Array} candles - Bougies OHLCV
 * @param {object} [options]
 * @param {number} [options.nbBuckets] - Nombre de niveaux de prix (défaut: 30)
 * @param {number} [options.valueAreaPct] - % du volume pour la value area (défaut: 70)
 * @returns {{ poc: number, vah: number, val: number, profile: Array, maxVolume: number }}
 */
function volumeProfile(candles, { nbBuckets = 30, valueAreaPct = 70 } = {}) {
  if (!candles || candles.length < 2) {
    return { poc: 0, vah: 0, val: 0, profile: [], maxVolume: 0 };
  }

  const high = Math.max(...candles.map(c => c.h));
  const low = Math.min(...candles.map(c => c.l));
  const range = high - low;
  if (range === 0) return { poc: 0, vah: 0, val: 0, profile: [], maxVolume: 0 };

  const bucketSize = range / nbBuckets;
  const buckets = [];

  // Initialiser les buckets
  for (let i = 0; i < nbBuckets; i++) {
    buckets.push({
      low: +(low + i * bucketSize).toFixed(6),
      high: +(low + (i + 1) * bucketSize).toFixed(6),
      volume: 0
    });
  }

  // Répartir le volume dans les buckets
  for (const c of candles) {
    const bucketIndex = Math.min(
      Math.floor((c.l - low) / bucketSize),
      nbBuckets - 1
    );
    if (bucketIndex >= 0 && bucketIndex < nbBuckets) {
      buckets[bucketIndex].volume += c.v || 0;
    }
  }

  // POC = bucket avec le plus de volume
  let poc = 0, maxVolume = 0;
  for (const b of buckets) {
    if (b.volume > maxVolume) {
      maxVolume = b.volume;
      poc = (b.low + b.high) / 2;
    }
  }

  // Value Area = zone contenant valueAreaPct % du volume
  const totalVolume = buckets.reduce((a, b) => a + b.volume, 0);
  const targetVolume = totalVolume * (valueAreaPct / 100);

  // Trouver le POC bucket
  const pocIndex = buckets.findIndex(b => (b.low + b.high) / 2 === poc);

  // Étendre la value area autour du POC
  let vah = buckets[pocIndex] ? buckets[pocIndex].high : high;
  let val = buckets[pocIndex] ? buckets[pocIndex].low : low;
  let accumulated = buckets[pocIndex] ? buckets[pocIndex].volume : 0;

  let up = pocIndex + 1;
  let down = pocIndex - 1;

  while (accumulated < targetVolume && (up < nbBuckets || down >= 0)) {
    const upVolume = up < nbBuckets ? buckets[up].volume : 0;
    const downVolume = down >= 0 ? buckets[down].volume : 0;

    if (upVolume >= downVolume && up < nbBuckets) {
      accumulated += upVolume;
      vah = buckets[up].high;
      up++;
    } else if (down >= 0) {
      accumulated += downVolume;
      val = buckets[down].low;
      down--;
    } else {
      break;
    }
  }

  return {
    poc: +poc.toFixed(6),
    vah: +vah.toFixed(6),
    val: +val.toFixed(6),
    profile: buckets,
    maxVolume
  };
}

/**
 * Identifie les niveaux de volume élevé (support/résistance).
 *
 * @param {object} vp - Résultat de volumeProfile()
 * @param {number} [seuilPct] - Seuil en % du volume max (défaut: 70)
 * @returns {Array<{ prix: number, volume: number, type: 'high'|'low' }>}
 */
function niveauxVolume(vp, seuilPct = 70) {
  if (!vp.profile || !vp.profile.length) return [];

  const seuil = vp.maxVolume * (seuilPct / 100);
  const niveaux = [];

  for (const b of vp.profile) {
    if (b.volume >= seuil) {
      niveaux.push({
        prix: +((b.low + b.high) / 2).toFixed(6),
        volume: b.volume,
        type: 'high'
      });
    }
  }

  return niveaux.sort((a, b) => b.volume - a.volume);
}

/**
 * Détecte les gaps de volume (niveaux sans volume = ruptures potentielles).
 *
 * @param {object} vp - Résultat de volumeProfile()
 * @returns {Array<{ low: number, high: number }>}
 */
function gapsVolume(vp) {
  if (!vp.profile || !vp.profile.length) return [];

  const gaps = [];
  for (const b of vp.profile) {
    if (b.volume === 0) {
      gaps.push({ low: b.low, high: b.high });
    }
  }
  return gaps;
}

module.exports = { volumeProfile, niveauxVolume, gapsVolume };
