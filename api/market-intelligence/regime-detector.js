/**
 * Market Intelligence — détection de régime.
 *
 * Un instrument change de comportement plusieurs fois par jour. Le régime ne
 * doit pas être deviné : il se mesure (ATR relatif, efficacité directionnelle,
 * largeur du range, pente) et il porte un niveau de confiance. Quand les données
 * ne permettent pas de trancher, le résultat est UNKNOWN — jamais un régime
 * inventé qui ferait accepter un setup.
 *
 * Version 1 : seuils provisoires, à recalibrer par instrument sur historique
 * (voir la roadmap, phase 3). Ils sont regroupés ici pour être versionnés.
 */

const SEUILS = {
  minimumBougies: 30,
  efficaciteTendance: 0.42,     // part du mouvement net dans le chemin parcouru
  penteTendance: 0.22,          // pente normalisée par l'ATR sur la fenêtre
  atrVolatil: 1.6,              // ATR récent / ATR de référence
  rangeEtroit: 2.2,             // amplitude / ATR : en dessous, marché étroit
  confianceMin: 0.5
};

function atr(bougies, periode = 14) {
  const vrais = [];
  for (let i = 1; i < bougies.length; i++) {
    const b = bougies[i], p = bougies[i - 1];
    vrais.push(Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)));
  }
  if (vrais.length < periode) return null;
  const lot = vrais.slice(-periode);
  return lot.reduce((a, v) => a + v, 0) / lot.length;
}

/**
 * Efficacité directionnelle : |dernier − premier| / somme des |variations|.
 * 1 = mouvement parfaitement rectiligne, 0 = aller-retour permanent.
 */
function efficacite(closes) {
  if (closes.length < 3) return 0;
  let chemin = 0;
  for (let i = 1; i < closes.length; i++) chemin += Math.abs(closes[i] - closes[i - 1]);
  if (chemin === 0) return 0;
  return Math.abs(closes[closes.length - 1] - closes[0]) / chemin;
}

/** Pente normalisée : variation totale rapportée à l'ATR, par bougie. */
function penteNormalisee(closes, a) {
  if (!a || closes.length < 2) return 0;
  return ((closes[closes.length - 1] - closes[0]) / a) / closes.length;
}

/**
 * @param {Array<{o,h,l,c,t,closed}>} bougies bougies CLÔTURÉES
 * @param {{instrument?:object}} [options]
 * @returns {{regime, confiance, mesures, raison}}
 */
function detecter(bougies, options = {}) {
  const closes = (bougies || [])
    .filter(b => b && Number.isFinite(b.c) && b.closed !== false)
    .map(b => b.c);

  if (closes.length < SEUILS.minimumBougies) {
    return {
      regime: 'UNKNOWN', confiance: 0,
      mesures: { bougies: closes.length },
      raison: `historique insuffisant (${closes.length} bougies, ${SEUILS.minimumBougies} requises) : régime non déterminable`
    };
  }

  const fenetre = closes.slice(-40);
  const a = atr((bougies || []).filter(b => b && b.closed !== false), 14);
  if (!a || !Number.isFinite(a) || a <= 0) {
    return { regime: 'UNKNOWN', confiance: 0, mesures: { bougies: closes.length }, raison: 'ATR non calculable : régime non déterminable' };
  }

  const aRef = atr((bougies || []).filter(b => b && b.closed !== false).slice(0, -20), 14) || a;
  const ratioVolatilite = a / aRef;
  const eff = efficacite(fenetre);
  const pente = penteNormalisee(fenetre, a);
  const amplitude = (Math.max(...fenetre) - Math.min(...fenetre)) / a;

  const mesures = {
    bougies: closes.length,
    atr: Number(a.toFixed(5)),
    atrRelatif: Number(ratioVolatilite.toFixed(2)),
    efficacite: Number(eff.toFixed(3)),
    pente: Number(pente.toFixed(3)),
    amplitudeAtr: Number(amplitude.toFixed(2))
  };

  // Volatilité d'abord : un marché brusque n'est ni tendance ni range stable.
  if (ratioVolatilite >= SEUILS.atrVolatil) {
    const force = Math.min(1, (ratioVolatilite - SEUILS.atrVolatil) / 1.4 + 0.55);
    return { regime: 'volatil', confiance: Number(force.toFixed(2)), mesures,
      raison: `ATR ${ratioVolatilite.toFixed(2)}× sa référence : mouvements brusques` };
  }

  if (eff >= SEUILS.efficaciteTendance && Math.abs(pente) >= SEUILS.penteTendance) {
    const force = Math.min(1, 0.5 + (eff - SEUILS.efficaciteTendance) * 1.8);
    return { regime: 'trending', confiance: Number(force.toFixed(2)), mesures,
      raison: `efficacité ${eff.toFixed(2)} et pente ${pente.toFixed(2)} : mouvement directionnel` };
  }

  if (amplitude <= SEUILS.rangeEtroit && ratioVolatilite < 1) {
    return { regime: 'faible volatilite', confiance: 0.6, mesures,
      raison: `amplitude ${amplitude.toFixed(2)} ATR et volatilité en baisse : marché étroit` };
  }

  if (eff < 0.25) {
    const force = Math.min(1, 0.5 + (0.25 - eff) * 2);
    return { regime: 'ranging', confiance: Number(force.toFixed(2)), mesures,
      raison: `efficacité ${eff.toFixed(2)} : allers-retours sans direction nette` };
  }

  // Signal mixte : on ne tranche pas.
  return { regime: 'UNKNOWN', confiance: Number(Math.min(0.45, eff).toFixed(2)), mesures,
    raison: `mesures contradictoires (efficacité ${eff.toFixed(2)}, pente ${pente.toFixed(2)}, volatilité ${ratioVolatilite.toFixed(2)}) : régime non tranchable` };
}

module.exports = { detecter, SEUILS, atr, efficacite };
