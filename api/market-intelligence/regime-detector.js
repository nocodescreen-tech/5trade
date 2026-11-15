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

// Seuils par défaut. Les seuils EFFECTIFS viennent du profil de la classe de
// marché (profils-classes.js) : un R_10 et un XAUUSD ne se lisent pas pareil.
const SEUILS = {
  minimumBougies: 30,
  efficaciteTendance: 0.42,     // part du mouvement net dans le chemin parcouru
  penteTendance: 0.22,          // pente normalisée par l'ATR sur la fenêtre
  atrVolatil: 1.6,              // ATR récent / ATR de référence
  rangeEtroit: 2.2,             // amplitude / ATR : en dessous, marché étroit
  confianceMin: 0.5
};

// UN SEUL ATR dans tout le dépôt : `engine/structure.atr` (lissage de Wilder).
// La version locale faisait une moyenne simple des 14 derniers TR, donc le ratio
// « ATR récent / ATR de référence » comparait deux formules différentes de la
// volatilité quand l'un des deux venait d'ailleurs.
const Structure = require('../engine/structure');

function atr(bougies, periode = 14) {
  if (!Array.isArray(bougies) || bougies.length < periode + 1) return null;
  const v = Structure.atr(bougies, periode);
  return Number.isFinite(v) && v > 0 ? v : null;
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
  const { seuilsRegime } = require('./profils-classes');
  const classe = options.classe || 'inconnu';
  const S = { ...SEUILS, ...seuilsRegime(classe) };
  const closes = (bougies || [])
    .filter(b => b && Number.isFinite(b.c) && b.closed !== false)
    .map(b => b.c);

  if (closes.length < S.minimumBougies) {
    return {
      regime: 'UNKNOWN', confiance: 0, classe, seuils: S,
      mesures: { bougies: closes.length },
      raison: `historique insuffisant (${closes.length} bougies, ${S.minimumBougies} requises) : régime non déterminable`
    };
  }

  const fenetre = closes.slice(-40);
  const a = atr((bougies || []).filter(b => b && b.closed !== false), 14);
  if (!a || !Number.isFinite(a) || a <= 0) {
    return { regime: 'UNKNOWN', confiance: 0, mesures: { bougies: closes.length }, classe, seuils: S, raison: 'ATR non calculable : régime non déterminable' };
  }

  // ATR de référence : sur les bougies ANCIENNES (sans les 20 dernières). Si
  // l'historique est trop court pour la calculer, on ne rabat pas sur l'ATR
  // courant — cela donnait un ratio de 1, donc « jamais volatil ». On rend le
  // ratio null et le régime le dit.
  const anciennes = (bougies || []).filter(b => b && b.closed !== false).slice(0, -20);
  const aRef = anciennes.length > 15 ? atr(anciennes, 14) : null;
  const ratioVolatilite = Number.isFinite(aRef) && aRef > 0 ? a / aRef : null;
  const eff = efficacite(fenetre);
  const pente = penteNormalisee(fenetre, a);
  const amplitude = (Math.max(...fenetre) - Math.min(...fenetre)) / a;

  // `ratioVolatilite` peut être null (référence non mesurable) : on ne peut plus
  // appeler .toFixed dessus. Le texte le dit au lieu de casser.
  const ratioTxt = ratioVolatilite === null ? 'non mesurable' : `${ratioVolatilite.toFixed(2)}×`;

  const mesures = {
    bougies: closes.length,
    classe,
    atr: Number(a.toFixed(5)),
    atrRelatif: ratioVolatilite === null ? null : Number(ratioVolatilite.toFixed(2)),
    efficacite: Number(eff.toFixed(3)),
    pente: Number(pente.toFixed(3)),
    amplitudeAtr: Number(amplitude.toFixed(2))
  };

  // Volatilité d'abord : un marché brusque n'est ni tendance ni range stable.
  if (ratioVolatilite !== null && ratioVolatilite >= S.atrVolatil) {
    const force = Math.min(1, (ratioVolatilite - S.atrVolatil) / 1.4 + 0.55);
    return { regime: 'volatil', confiance: Number(force.toFixed(2)), mesures, classe, seuils: S,
      raison: `ATR ${ratioTxt} sa référence : mouvements brusques` };
  }

  if (eff >= S.efficaciteTendance && Math.abs(pente) >= S.penteTendance) {
    const force = Math.min(1, 0.5 + (eff - S.efficaciteTendance) * 1.8);
    return { regime: 'trending', confiance: Number(force.toFixed(2)), mesures, classe, seuils: S,
      raison: `efficacité ${eff.toFixed(2)} et pente ${pente.toFixed(2)} : mouvement directionnel` };
  }

  if (amplitude <= S.rangeEtroit && ratioVolatilite !== null && ratioVolatilite < 1) {
    return { regime: 'faible volatilite', confiance: 0.6, mesures, classe, seuils: S,
      raison: `amplitude ${amplitude.toFixed(2)} ATR et volatilité en baisse : marché étroit` };
  }

  if (eff < 0.25) {
    const force = Math.min(1, 0.5 + (0.25 - eff) * 2);
    return { regime: 'ranging', confiance: Number(force.toFixed(2)), mesures, classe, seuils: S,
      raison: `efficacité ${eff.toFixed(2)} : allers-retours sans direction nette` };
  }

  // Signal mixte : on ne tranche pas.
  return { regime: 'UNKNOWN', confiance: Number(Math.min(0.45, eff).toFixed(2)), mesures, classe, seuils: S,
    raison: `mesures contradictoires (efficacité ${eff.toFixed(2)}, pente ${pente.toFixed(2)}, volatilité ${ratioTxt}) : régime non tranchable` };
}

module.exports = { detecter, SEUILS, atr, efficacite };
