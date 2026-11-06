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

function atr(candles, periode = 14) {
  if (!Array.isArray(candles) || candles.length < periode + 2) return null;
  const vrais = [];
  for (let i = candles.length - periode; i < candles.length; i++) {
    const b = candles[i], p = candles[i - 1];
    if (!b || !p) continue;
    vrais.push(Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)));
  }
  if (!vrais.length) return null;
  const moyenne = vrais.reduce((a, b) => a + b, 0) / vrais.length;
  return Number.isFinite(moyenne) && moyenne > 0 ? moyenne : null;
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
function planBalayage(candles, sens) {
  const a = atr(candles);
  const last = candles[candles.length - 1];
  if (!a || !last) return null;
  const fenetre = candles.slice(-20);
  const plusBas = Math.min(...fenetre.map(c => c.l));
  const plusHaut = Math.max(...fenetre.map(c => c.h));
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

/** Déplacement : le stop se place à 1 ATR derrière la bougie d'impulsion. */
function planDeplacement(candles, sens) {
  const a = atr(candles);
  const last = candles[candles.length - 1];
  if (!a || !last) return null;
  const entree = last.c;
  const stop = sens === 'BUY' ? entree - a : entree + a;
  const distance = Math.abs(entree - stop);
  const cible = sens === 'BUY' ? entree + 2 * distance : entree - 2 * distance;
  return valide({ entree: arrondi(entree, entree), stop: arrondi(stop, entree),
    objectifs: [arrondi(cible, entree)] }, sens);
}

/** Zone : entrée au contact, stop juste au-delà, objectif à 2 fois la zone. */
function planZone(candles, sens, zone) {
  const a = atr(candles);
  const last = candles[candles.length - 1];
  if (!a || !last) return null;
  const entree = last.c;
  // Zone fournie par l'appelant (bord bas et haut) sinon on prend la bougie.
  const bordBas = Number.isFinite(zone && zone.bas) ? zone.bas : last.l;
  const bordHaut = Number.isFinite(zone && zone.haut) ? zone.haut : last.h;
  const hauteur = Math.max(bordHaut - bordBas, 0.3 * a);
  const stop = sens === 'BUY' ? bordBas - 0.2 * a : bordHaut + 0.2 * a;
  const distance = Math.abs(entree - stop);
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
  return planDeplacement(candles, sens);
}

module.exports = { construire, planBalayage, planDeplacement, planZone, atr, valide };
