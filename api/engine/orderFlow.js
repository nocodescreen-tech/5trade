/**
 * 5trade — order flow.
 *
 * Analyse le flux d'ordres pour détecter :
 *   • Imbalance bid/ask (déséquilibre entre acheteurs et vendeurs)
 *   • Absorption (un niveau qui absorbe les ordres)
 *   • Spoofing (faux ordres pour tromper les autres traders)
 *   • Delta (différence entre volume acheteur et vendeur)
 */

/**
 * Calcule le delta entre volume acheteur et vendeur.
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<number>} Delta pour chaque bougie
 */
function delta(candles) {
  if (!candles || !candles.length) return [];

  const deltas = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];

    // Delta estimé à partir de la position de la clôture dans la bougie.
    // L'ancienne version disait « si le prix monte, 100 % du volume est
    // acheteur » : une bougie qui ouvre à 100, monte à 130 puis clôture à 101
    // comptait autant d'achat que si elle avait clôturé à 129. La formule
    // retenue (volume × part d'achat − volume × part de vente) répartit le
    // volume selon la clôture dans le range, ce qui est l'estimation standard
    // quand on ne dispose que d'OHLCV.
    const volume = cur.v || 0;
    if (cur.volumeSource === 'binance_spot' && Number.isFinite(cur.takerBuyBase) && Number.isFinite(cur.v) && cur.v >= 0 && cur.takerBuyBase >= 0 && cur.takerBuyBase <= cur.v) {
      deltas.push(2 * cur.takerBuyBase - cur.v);
      continue;
    }
    const range = cur.h - cur.l;
    let deltaValue;
    if (range > 0) {
      const part = (cur.c - cur.l) / range;          // 0 = clôture au plus bas
      deltaValue = volume * (2 * part - 1);          // −volume … +volume
    } else {
      const priceChange = cur.c - candles[i - 1].c;  // bougie sans amplitude
      deltaValue = priceChange > 0 ? volume : priceChange < 0 ? -volume : 0;
    }

    deltas.push(+deltaValue.toFixed(2));
  }

  return deltas;
}

/**
 * Détecte les imbalances bid/ask.
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<{ index: number, type: 'bid'|'ask', force: number, detail: string }>}
 */
function imbalances(candles) {
  if (!candles || !candles.length) return [];

  const imbalances = [];
  const deltas = delta(candles);

  for (let i = 1; i < deltas.length; i++) {
    // Imbalance haussier : delta positif après un delta négatif
    if (deltas[i] > 0 && deltas[i - 1] < 0 && Math.abs(deltas[i]) > Math.abs(deltas[i - 1]) * 1.5) {
      imbalances.push({
        index: i + 1,
        type: 'bid',
        force: Math.min(Math.abs(deltas[i]) / Math.abs(deltas[i - 1]), 10),
        detail: `imbalance bid : delta ${deltas[i].toFixed(2)} après ${deltas[i - 1].toFixed(2)}`
      });
    }

    // Imbalance baissier : delta négatif après un delta positif
    if (deltas[i] < 0 && deltas[i - 1] > 0 && Math.abs(deltas[i]) > Math.abs(deltas[i - 1]) * 1.5) {
      imbalances.push({
        index: i,
        type: 'ask',
        force: Math.min(Math.abs(deltas[i]) / Math.abs(deltas[i - 1]), 10),
        detail: `imbalance ask : delta ${deltas[i].toFixed(2)} après ${deltas[i - 1].toFixed(2)}`
      });
    }
  }

  return imbalances;
}

/**
 * Détecte l'absorption (un niveau qui absorbe les ordres).
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<{ prix: number, type: 'achat'|'vente', force: number, detail: string }>}
 */
function absorption(candles) {
  if (!candles || !candles.length) return [];

  const absorptions = [];
  const deltas = delta(candles);

  // L'absorption se produit quand le prix ne bouge pas malgré un volume élevé.
  // La comparaison d'origine était `priceRange < avgVolume * 0.001` : une
  // distance de PRIX comparée à un VOLUME, deux unités sans rapport. Sur l'or
  // comme sur EURUSD elle ne pouvait jamais être vraie. On compare désormais ce
  // qui est comparable : l'amplitude de la fenêtre à sa propre amplitude
  // moyenne, et le volume à sa propre moyenne.
  for (let i = 5; i < candles.length; i++) {
    const recent = candles.slice(i - 5, i + 1);
    const priceRange = Math.max(...recent.map(c => c.h)) - Math.min(...recent.map(c => c.l));
    const avgRange = recent.reduce((a, c) => a + (c.h - c.l), 0) / recent.length;
    const avgVolume = recent.reduce((a, c) => a + (c.v || 0), 0) / recent.length;

    // Référence de volume : les 20 bougies précédentes, pas la fenêtre elle-même.
    const base = candles.slice(Math.max(0, i - 25), i - 5);
    const volumeRef = base.length ? base.reduce((a, c) => a + (c.v || 0), 0) / base.length : 0;

    const rangeCompresse = avgRange > 0 && priceRange < avgRange * 3;
    const volumeEleve = volumeRef > 0 ? avgVolume > volumeRef * 1.5 : avgVolume > 0;
    if (rangeCompresse && volumeEleve) {
      const prix = (candles[i].h + candles[i].l) / 2;
      const type = deltas[i - 1] > 0 ? 'achat' : 'vente';

      absorptions.push({
        prix: +prix.toFixed(6),
        type,
        force: volumeRef > 0 ? +Math.min(avgVolume / volumeRef, 10).toFixed(2) : null,
        detail: `absorption ${type} à ${prix.toFixed(2)} — amplitude ${priceRange.toFixed(4)} `
          + `avec volume ${avgVolume.toFixed(0)}${volumeRef > 0 ? ` (${(avgVolume / volumeRef).toFixed(1)}× la référence)` : ''}`
      });
    }
  }

  return absorptions;
}

/**
 * Détecte le spoofing (faux ordres).
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<{ prix: number, type: 'bid'|'ask', detail: string }>}
 */
function spoofing(candles) {
  if (!candles || !candles.length) return [];

  const spoofs = [];

  // Un carnet d'ordres est nécessaire pour VOIR un spoofing (un ordre affiché
  // puis retiré avant exécution). Avec des bougies, on ne peut observer qu'un
  // PROXY : un pic de volume isolé suivi d'un retournement immédiat — le
  // schéma qu'un faux ordre laisse derrière lui. L'ancienne version ne
  // regardait que le pic (`cur.v > prev.v * 3 && cur.v > next.v * 3`), sans
  // jamais vérifier le retournement, et annonçait donc « spoofing » sur une
  // simple bougie de news. Le libellé dit maintenant ce qu'il mesure.
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    const next = candles[i + 1];

    const pic = cur.v > prev.v * 3 && cur.v > next.v * 3;
    const sensCur = Math.sign(cur.c - cur.o);
    const sensNext = Math.sign(next.c - next.o);
    const retournement = sensCur !== 0 && sensNext !== 0 && sensNext !== sensCur;
    if (pic && retournement) {
      const prix = (cur.h + cur.l) / 2;
      const type = cur.c > cur.o ? 'bid' : 'ask';

      spoofs.push({
        prix: +prix.toFixed(6),
        type,
        proxy: true,
        detail: `pic de volume isolé à ${prix.toFixed(2)} (${cur.v.toFixed(0)}, `
          + `${(cur.v / Math.max(prev.v || 1, 1)).toFixed(1)}× la bougie précédente) puis retournement `
          + `— proxy de spoofing, pas une preuve (il faudrait le carnet d'ordres)`
      });
    }
  }

  return spoofs;
}

/**
 * Analyse complète de l'order flow.
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {object} Analyse complète
 */
function analyserOrderFlow(candles) {
  if (!Array.isArray(candles) || candles.length < 2 || !candles.every(c => Number.isFinite(c.v) && c.v >= 0) || !candles.some(c => c.v > 0)) {
    return { disponible: false, methode: 'indisponible', delta: [], cvd: [], imbalances: [], absorption: [], spoofing: [], raison: 'Volume inexploitable' };
  }
  const exact = candles.every(c => c.volumeSource === 'binance_spot' && Number.isFinite(c.takerBuyBase) && c.takerBuyBase >= 0 && c.takerBuyBase <= c.v);
  const series = delta(candles);
  let cumulative = 0;
  return {
    disponible: true, methode: exact ? 'delta_taker_binance_spot' : 'estimation_ohlcv_ou_mixte',
    delta: series, cvd: series.map((v,i) => ({ t: candles[i+1].t, value: cumulative += v })),
    imbalances: imbalances(candles), absorption: absorption(candles), spoofing: spoofing(candles),
    limites: ['Imbalance, absorption et spoofing restent des proxys ; aucune preuve de carnet d’ordres.','CVD limité à la fenêtre reçue.']
  };
}

module.exports = { delta, imbalances, absorption, spoofing, analyserOrderFlow };
