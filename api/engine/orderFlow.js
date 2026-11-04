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
    const prev = candles[i - 1];
    const cur = candles[i];

    // Delta approximatif : si le prix monte, plus d'acheteurs ; si descend, plus de vendeurs
    const priceChange = cur.c - prev.c;
    const volume = cur.v || 0;
    const deltaValue = priceChange > 0 ? volume : priceChange < 0 ? -volume : 0;

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
        index: i,
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

  // L'absorption se produit quand le prix ne bouge pas malgré un volume élevé
  for (let i = 5; i < candles.length; i++) {
    const recent = candles.slice(i - 5, i + 1);
    const priceRange = Math.max(...recent.map(c => c.h)) - Math.min(...recent.map(c => c.l));
    const avgVolume = recent.reduce((a, c) => a + (c.v || 0), 0) / recent.length;

    // Si le range est petit mais le volume élevé = absorption
    if (priceRange < avgVolume * 0.001 && avgVolume > 0) {
      const prix = (candles[i].h + candles[i].l) / 2;
      const type = deltas[i] > 0 ? 'achat' : 'vente';

      absorptions.push({
        prix: +prix.toFixed(6),
        type,
        force: Math.min(avgVolume / 1000, 10),
        detail: `absorption ${type} à ${prix.toFixed(2)} — range ${priceRange.toFixed(2)} avec volume ${avgVolume.toFixed(0)}`
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

  // Le spoofing se produit quand un grand volume est suivi d'un mouvement inverse
  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    const next = candles[i + 1];

    // Grand volume suivi d'un mouvement inverse
    if (cur.v > prev.v * 3 && cur.v > next.v * 3) {
      const prix = (cur.h + cur.l) / 2;
      const type = cur.c > cur.o ? 'bid' : 'ask';

      spoofs.push({
        prix: +prix.toFixed(6),
        type,
        detail: `spoofing ${type} à ${prix.toFixed(2)} — volume ${cur.v.toFixed(0)} suivi d'un mouvement inverse`
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
  return {
    delta: delta(candles),
    imbalances: imbalances(candles),
    absorption: absorption(candles),
    spoofing: spoofing(candles)
  };
}

module.exports = { delta, imbalances, absorption, spoofing, analyserOrderFlow };
