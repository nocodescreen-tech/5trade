/**
 * 5trade — reconnaissance de patterns (ADAPTATEUR).
 *
 * Ce module ne détecte plus rien lui-même : il traduit la sortie de
 * `engine/patterns.js` vers l'ancien format { type, nom, direction, force,
 * detail } attendu par /api/patterns et par l'écran.
 *
 * Pourquoi : le dépôt avait DEUX implémentations des mêmes figures, avec des
 * seuils différents — `patterns.js` (utilisé par Multi.detecterTout, donc par
 * les décisions) et ce module (exposé par /api/patterns, donc par l'écran).
 * Un marteau pouvait être affiché à l'écran et absent de la décision, ou
 * l'inverse. Corriger un seuil dans l'un laissait l'autre mentir.
 *
 * Ce qui a été corrigé en devenant un adaptateur :
 *   • hammer / shooting star sans contexte : `patterns.js` exige une pression
 *     préalable (marteau après des bougies baissières, étoile filante après des
 *     hausses), ce module ne regardait qu'une bougie isolée ;
 *   • double top / double bottom sans ligne de col : `patterns.js` vérifie le
 *     col ET sa cassure, ici deux hauts proches suffisaient ;
 *   • head & shoulders découpé en fenêtres fixes [0-10, 10-20, 20-30] : la
 *     figure n'était cherchée que sur exactement 30 bougies et sans ligne de
 *     col. Elle est réimplémentée ci-dessous, adaptée à la longueur réelle et
 *     validée par la cassure du col.
 */

const { analyse } = require('./patterns');

/** Sens du moteur → vocabulaire de l'API historique. */
const DIRECTION = { long: 'BUY', short: 'SELL', neutre: 'NEUTRE' };

/** Un motif `patterns.js` → une entrée de l'API historique. */
function versLegacy(m) {
  const detail = (m.preuves || []).join(' · ');
  return {
    type: m.id,
    nom: m.nom,
    direction: DIRECTION[m.sens] || 'NEUTRE',
    force: m.force,
    detail: detail || m.nom
  };
}

/** Analyse défensive : jamais d'exception pour un endpoint d'affichage. */
function analyseSure(candles) {
  if (!Array.isArray(candles) || candles.length < 20) return null;
  try {
    return analyse(candles);
  } catch {
    return null;
  }
}

/**
 * Épaule–tête–épaule (et son inverse), validée par la ligne de col.
 *
 * La figure est cherchée sur les 90 dernières bougies : la tête est l'extrême
 * le plus marqué, les épaules les extrêmes de part et d'autre, et la ligne de
 * col est le point bas (ou haut) entre tête et épaules. Sans cassure du col, ce
 * n'est pas une figure — c'est un range.
 */
function epauleTeteEpaule(candles) {
  const zone = (candles || []).slice(-90);
  const n = zone.length;
  const marge = 5;                       // bougies minimales entre deux points
  if (n < 2 * marge + 3) return [];

  const out = [];
  const chercher = (haut) => {
    const extreme = c => (haut ? c.h : c.l);
    const oppose = c => (haut ? c.l : c.h);
    const compare = (x, y) => (haut ? x > y : x < y);

    let tete = -1;
    for (let i = marge; i < n - marge; i++) {
      if (tete < 0 || compare(extreme(zone[i]), extreme(zone[tete]))) tete = i;
    }
    if (tete < 0) return null;

    let gauche = -1, droite = -1;
    for (let i = 0; i <= tete - marge; i++) {
      if (gauche < 0 || compare(extreme(zone[i]), extreme(zone[gauche]))) gauche = i;
    }
    for (let i = tete + marge; i < n; i++) {
      if (droite < 0 || compare(extreme(zone[i]), extreme(zone[droite]))) droite = i;
    }
    if (gauche < 0 || droite < 0) return null;

    const eG = extreme(zone[gauche]), eT = extreme(zone[tete]), eD = extreme(zone[droite]);
    // La tête doit dominer les deux épaules.
    if (!compare(eT, eG) || !compare(eT, eD)) return null;
    // Épaules symétriques : écart ≤ 25 % de la hauteur tête → épaules.
    const hauteur = Math.abs(eT - Math.min(eG, eD));
    if (!(hauteur > 0)) return null;
    if (Math.abs(eG - eD) / hauteur > 0.25) return null;

    // Ligne de col : le repli le plus profond de chaque côté de la tête.
    const colGauche = haut
      ? Math.min(...zone.slice(gauche, tete + 1).map(oppose))
      : Math.max(...zone.slice(gauche, tete + 1).map(oppose));
    const colDroite = haut
      ? Math.min(...zone.slice(tete, droite + 1).map(oppose))
      : Math.max(...zone.slice(tete, droite + 1).map(oppose));
    const col = haut ? Math.min(colGauche, colDroite) : Math.max(colGauche, colDroite);

    const dernier = zone[n - 1];
    const casse = haut ? dernier.c < col : dernier.c > col;
    const direction = haut ? 'SELL' : 'BUY';
    const nom = haut ? 'Épaule–tête–épaule' : 'Épaule–tête–épaule inversée';

    return {
      type: haut ? 'head_and_shoulders' : 'head_and_shoulders_inverse',
      nom,
      direction: casse ? direction : 'NEUTRE',
      force: casse ? 0.8 : 0,
      detail: `épaule gauche ${eG.toFixed(2)}, tête ${eT.toFixed(2)}, épaule droite ${eD.toFixed(2)} · `
        + `col ${col.toFixed(2)} ${casse ? `cassé (close ${dernier.c.toFixed(2)})` : `intact (close ${dernier.c.toFixed(2)})`}`
    };
  };

  for (const haut of [true, false]) {
    const r = chercher(haut);
    // Une figure sans cassure de col n'est pas confirmée : on ne la publie pas
    // comme un signal (elle reste lisible dans les chiffres ci-dessus).
    if (r && r.direction !== 'NEUTRE') out.push(r);
  }
  return out;
}

/**
 * Patterns de chandeliers (1 à 3 bougies).
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<{ type: string, nom: string, direction: 'BUY'|'SELL'|'NEUTRE', force: number, detail: string }>}
 */
function patternsChandeliers(candles) {
  const r = analyseSure(candles);
  if (!r) return [];
  return r.motifs.filter(m => m.ok && m.famille === 'bougie').map(versLegacy);
}

/**
 * Patterns de graphique (plusieurs bougies).
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<{ type: string, nom: string, direction: 'BUY'|'SELL'|'NEUTRE', force: number, detail: string }>}
 */
function patternsGraphique(candles) {
  const r = analyseSure(candles);
  const base = r ? r.motifs.filter(m => m.ok && m.famille !== 'bougie').map(versLegacy) : [];
  return [...base, ...epauleTeteEpaule(candles)];
}

/**
 * Patterns de continuation (drapeaux).
 *
 * La fenêtre est locale (les 30 dernières bougies) : l'ancienne version coupait
 * TOUTE la série en deux moitiés, si bien qu'un drapeau « impulsee puis
 * correction » était en réalité une comparaison entre deux semaines d'historique.
 *
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<{ type: string, nom: string, direction: 'BUY'|'SELL'|'NEUTRE', force: number, detail: string }>}
 */
function patternsContinuation(candles) {
  const zone = (candles || []).slice(-30);
  if (zone.length < 15) return [];

  const milieu = Math.floor(zone.length / 2);
  const premiere = zone.slice(0, milieu);
  const seconde = zone.slice(milieu);
  const tendance1 = premiere[premiere.length - 1].c - premiere[0].c;
  const tendance2 = seconde[seconde.length - 1].c - seconde[0].c;

  const patterns = [];
  if (tendance1 > 0 && tendance2 < 0 && Math.abs(tendance2) < Math.abs(tendance1) * 0.5) {
    patterns.push({
      type: 'flag_haussier',
      nom: 'Drapeau haussier',
      direction: 'BUY',
      force: 0.6,
      detail: `impulsion haussière (${tendance1.toFixed(2)}) suivie d'une correction de ${tendance2.toFixed(2)} — continuation probable`
    });
  }
  if (tendance1 < 0 && tendance2 > 0 && Math.abs(tendance2) < Math.abs(tendance1) * 0.5) {
    patterns.push({
      type: 'flag_baissier',
      nom: 'Drapeau baissier',
      direction: 'SELL',
      force: 0.6,
      detail: `impulsion baissière (${tendance1.toFixed(2)}) suivie d'un rebond de ${tendance2.toFixed(2)} — continuation probable`
    });
  }
  return patterns;
}

/**
 * Détecte tous les patterns.
 * @param {Array} candles - Bougies OHLCV
 * @returns {Array<{ type: string, nom: string, direction: 'BUY'|'SELL'|'NEUTRE', force: number, detail: string }>}
 */
function detecterPatterns(candles) {
  return [
    ...patternsChandeliers(candles),
    ...patternsGraphique(candles),
    ...patternsContinuation(candles)
  ];
}

module.exports = {
  patternsChandeliers, patternsGraphique, patternsContinuation, detecterPatterns,
  epauleTeteEpaule
};
