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
  const unavailable = raison => ({ poc: null, vah: null, val: null, profile: [], maxVolume: 0, disponible: false, raison });
  if (!Array.isArray(candles) || candles.length < 2) return unavailable('Historique insuffisant');
  if (!candles.every(c => Number.isFinite(c.v) && c.v >= 0 && Number.isFinite(c.h) && Number.isFinite(c.l) && c.h >= c.l) || !candles.some(c => c.v > 0)) return unavailable('Volume ou prix indisponible');
  nbBuckets = Math.min(200, Math.max(2, Math.floor(Number(nbBuckets) || 30)));
  valueAreaPct = Math.min(100, Math.max(1, Number(valueAreaPct) || 70));

  const high = Math.max(...candles.map(c => c.h));
  const low = Math.min(...candles.map(c => c.l));
  const range = high - low;
  if (range === 0) return unavailable('Amplitude nulle');

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

  // Répartir le volume dans les buckets.
  // Le volume d'une bougie ne vient pas de son PLUS BAS : il s'est échangé sur
  // toute son amplitude [low, high]. Tout attribuer au bucket du low tassait le
  // profil vers le bas et décalait le POC d'un cran à chaque bougie de grande
  // amplitude — sur une tendance, le POC finissait par désigner un niveau que le
  // prix n'avait fait que traverser. On répartit donc au prorata du recouvrement
  // de chaque bucket avec l'amplitude de la bougie.
  for (const c of candles) {
    const v = c.v || 0;
    if (!(v > 0)) continue;
    const bas = c.l, haut = c.h;
    if (!(haut > bas)) {                       // bougie sans amplitude (doji plat)
      const idx = Math.min(Math.max(Math.floor((bas - low) / bucketSize), 0), nbBuckets - 1);
      buckets[idx].volume += v;
      continue;
    }
    const premier = Math.min(Math.max(Math.floor((bas - low) / bucketSize), 0), nbBuckets - 1);
    const dernier = Math.min(Math.max(Math.floor((haut - low) / bucketSize), 0), nbBuckets - 1);
    const parts = [];
    let total = 0;
    for (let k = premier; k <= dernier; k++) {
      const recouvrement = Math.min(haut, buckets[k].high) - Math.max(bas, buckets[k].low);
      if (recouvrement > 0) { parts.push([k, recouvrement]); total += recouvrement; }
    }
    if (!total) { buckets[premier].volume += v; continue; }
    for (const [k, poids] of parts) buckets[k].volume += v * (poids / total);
  }

  // POC = bucket avec le plus de volume (on garde son INDEX : le retrouver
  // ensuite en comparant des milieux arrondis échouait une fois sur deux).
  let poc = 0, maxVolume = 0, pocIndex = 0;
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i].volume > maxVolume) {
      maxVolume = buckets[i].volume;
      pocIndex = i;
      poc = (buckets[i].low + buckets[i].high) / 2;
    }
  }

  // Value Area = zone contenant valueAreaPct % du volume
  const totalVolume = buckets.reduce((a, b) => a + b.volume, 0);
  const targetVolume = totalVolume * (valueAreaPct / 100);

  // Trouver le POC bucket
  // (l'index est mémorisé pendant la recherche du maximum — plus fiable que de
  //  réidentifier le bucket par comparaison de milieux)

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
    maxVolume, disponible: true, methode: 'estimation_ohlcv',
    note: 'Répartition estimée du volume sur les amplitudes, pas un profil transaction par transaction.'
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
