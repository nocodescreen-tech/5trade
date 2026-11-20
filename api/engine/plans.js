/**
 * Constructeur de plan de trade — un par famille de setup.
 *
 * Constat mesuré (docs/MESURE-2026-11-05.md) : une règle peut s'activer 78 % du
 * temps sans produire de trade, parce que le moteur exige un plan complet et ne
 * sait le dériver que d'une structure nette. Toutes les stratégies sont donc
 * limitées au même petit nombre de trades.
 *
 * Ici, chaque famille construit SON plan :
 *   balayage    → stop derrière le niveau balayé, objectif sur la liquidité opposée
 *   deplacement → stop à 1 ATR derrière la bougie d'impulsion, objectif 2 R
 *   zone        → entrée au bord de la zone, stop au-delà de la zone, objectif 2 R
 *
 * Aucun de ces plans n'invente de niveau : ils partent tous d'un prix observé
 * (extrême, bord de zone) et d'une volatilité mesurée (ATR). Si l'un des deux
 * manque, le plan n'est pas produit — et le signal reste sans niveau plutôt que
 * d'en recevoir un faux.
 */

// UN SEUL ATR dans tout le dépôt : celui de `structure.js` (lissage de Wilder).
// La version locale faisait une MOYENNE SIMPLE des 14 derniers TR : pour le même
// marché au même instant, un stop calculé ici et un stop calculé ailleurs
// n'avaient pas la même largeur. Deux formules = deux vérités = aucun résultat
// reproductible.
const Structure = require('./structure');
function atr(candles, periode = 14) {
  if (!Array.isArray(candles) || candles.length < periode + 2) return null;
  const v = Structure.atr(candles, periode);
  return Number.isFinite(v) && v > 0 ? v : null;
}

const arrondi = (v, ref) => {
  const pas = Math.abs(ref) >= 1000 ? 2 : Math.abs(ref) >= 10 ? 4 : 5;
  return Number(Number(v).toFixed(pas));
};

/** Le plan est-il exploitable ? Un stop égal à l'entrée n'est pas un stop. */
function valide(plan, sens) {
  if (!plan) return null;
  const { entree, stop, objectifs } = plan;
  if (![entree, stop].every(Number.isFinite)) return null;
  const distance = Math.abs(entree - stop);
  if (!(distance > 0)) return null;
  const propres = (objectifs || []).filter(o => Number.isFinite(o)
    && (sens === 'BUY' ? o > entree : o < entree));
  if (!propres.length) return null;
  return { entree, stop, objectifs: propres, rr: Math.abs(propres[0] - entree) / distance };
}

/**
 * Balayage : on est entré dans le sens du retour après avoir pris la liquidité.
 * Le stop se place derrière l'extrême qui vient d'être balayé (plus une marge de
 * 0,2 ATR pour ne pas être sorti par un simple spread élargi).
 */
function planBalayage(candles, sens, options = {}) {
  const a = atr(candles);
  const last = candles[candles.length - 1];
  if (!a || !last) return null;

  // Si l'appelant fournit le niveau précis de sweep ou la mèche de balayage, on l'utilise directement
  const extremeBalaye = Number.isFinite(options.niveauSweep)
    ? options.niveauSweep
    : Number.isFinite(options.extreme)
      ? options.extreme
      : null;

  const fenetre = candles.slice(-20);
  const plusBas = extremeBalaye !== null && sens === 'BUY'
    ? Math.min(extremeBalaye, ...candles.slice(-5).map(c => c.l))
    : Math.min(...fenetre.map(c => c.l));
  const plusHaut = extremeBalaye !== null && sens === 'SELL'
    ? Math.max(extremeBalaye, ...candles.slice(-5).map(c => c.h))
    : Math.max(...fenetre.map(c => c.h));

  const entree = last.c;
  if (sens === 'BUY') {
    const stop = plusBas - 0.2 * a;
    const distance = entree - stop;
    return valide({ entree: arrondi(entree, entree), stop: arrondi(stop, entree),
      objectifs: [arrondi(entree + 2 * distance, entree), arrondi(entree + 3 * distance, entree)] }, sens);
  }
  const stop = plusHaut + 0.2 * a;
  const distance = stop - entree;
  return valide({ entree: arrondi(entree, entree), stop: arrondi(stop, entree),
    objectifs: [arrondi(entree - 2 * distance, entree), arrondi(entree - 3 * distance, entree)] }, sens);
}

/** Déplacement : le stop se place sur l'extrême de la bougie d'impulsion (avec marge 0.1 ATR). */
function planDeplacement(candles, sens) {
  const a = atr(candles);
  const last = candles[candles.length - 1];
  if (!a || !last) return null;
  const entree = last.c;
  // Stop basé sur l'extrême réel de la bougie d'impulsion, pas sur 1 ATR abstrait
  const stop = sens === 'BUY'
    ? Math.min(last.l - 0.1 * a, entree - 0.5 * a)
    : Math.max(last.h + 0.1 * a, entree + 0.5 * a);
  const distance = Math.abs(entree - stop);
  const cible = sens === 'BUY' ? entree + 2 * distance : entree - 2 * distance;
  return valide({ entree: arrondi(entree, entree), stop: arrondi(stop, entree),
    objectifs: [arrondi(cible, entree)] }, sens);
}

/** Zone : entrée au contact réel de la zone (ou retest), stop au-delà calibré sur sa hauteur réelle. */
function planZone(candles, sens, zone) {
  const a = atr(candles);
  const last = candles[candles.length - 1];
  if (!a || !last) return null;

  // Zone fournie par l'appelant (bord bas et haut) sinon on prend la bougie.
  const bordBas = Number.isFinite(zone && zone.bas) ? zone.bas : last.l;
  const bordHaut = Number.isFinite(zone && zone.haut) ? zone.haut : last.h;
  const hauteur = Math.max(bordHaut - bordBas, 0.3 * a);

  // Entrée au contact de la zone (haut de zone pour un BUY en pullback, bas pour SELL)
  // ou prix actuel si déjà à l'intérieur.
  const entreeContact = sens === 'BUY'
    ? (last.c >= bordBas && last.c <= bordHaut ? last.c : bordHaut)
    : (last.c >= bordBas && last.c <= bordHaut ? last.c : bordBas);
  const entree = Number.isFinite(entreeContact) ? entreeContact : last.c;

  // Le stop et l'objectif utilisent explicitement la hauteur de zone réelle
  const marge = Math.min(0.2 * a, hauteur * 0.25);
  const stop = sens === 'BUY' ? bordBas - marge : bordHaut + marge;
  const distance = Math.max(Math.abs(entree - stop), hauteur);
  if (!(distance > 0)) return null;
  const cible = sens === 'BUY' ? entree + 2 * distance : entree - 2 * distance;
  return valide({ entree: arrondi(entree, entree), stop: arrondi(stop, entree),
    objectifs: [arrondi(cible, entree)] }, sens);
}

/**
 * Construit le plan correspondant à la famille demandée.
 * @param {string} mode 'balayage' | 'deplacement' | 'zone'
 */
function construire(candles, sens, mode = 'deplacement', options = {}) {
  if (sens !== 'BUY' && sens !== 'SELL') return null;
  if (!Array.isArray(candles) || candles.length < 20) return null;
  if (mode === 'balayage') return planBalayage(candles, sens);
  if (mode === 'zone') return planZone(candles, sens, options.zone);
  if (mode === 'deplacement') return planDeplacement(candles, sens);
  // Mode inconnu : refuse explicitement au lieu de basculer silencieusement
  return null;
}

module.exports = { construire, planBalayage, planDeplacement, planZone, atr, valide };
