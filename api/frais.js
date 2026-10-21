/**
 * 5trade — FRAIS DE TRANSACTION (spread, commission).
 *
 * Le problème résolu : le journal et le backtest jugeaient les trades sur les
 * prix bruts du graphique. Aucun coût n'était retiré. Un signal qui « atteint
 * son objectif » n'est pas un gain si le spread mangé à l'entrée représente 10 %
 * du risque : le R affiché est alors trop beau, et un modèle entraîné sur ces
 * chiffres apprend un avantage qui n'existe pas.
 *
 * Ce que le module ne fait PAS : il n'invente pas de spread. Tant que la
 * configuration vaut 0, le coût est nul et le R net est IDENTIQUE au R brut —
 * aucun verdict existant ne change. Dès qu'on renseigne une valeur, elle
 * s'applique partout de la même façon (journal live et backtest, une seule
 * définition, via `evaluer()`).
 *
 * Conventions assumées, écrites ici :
 *  - `spread` est en UNITÉS DE PRIX (pas en pips) : c'est l'unité que le moteur
 *    manipule. Un spread de 0,30 sur l'or à 4100 est 0,30 point, pas 30.
 *  - `commissionPct` est une FRACTION du notionnel, payée à l'entrée ET à la
 *    sortie (0.001 = 0,1 % par côté, cas standard d'un exchange crypto).
 *  - le coût total est payé UNE fois par trade, à l'entrée.
 *  - un signal expiré porte quand même le coût : la position a été prise.
 *
 * Stockage : data/frais.json (surchargeable par FRAIS_FICHIER pour les tests —
 * même doctrine que ALERTS_FICHIER et JOURNAL_SIGNAUX_FICHIER).
 */

const fs = require('fs');
const path = require('path');

const FICHIER = process.env.FRAIS_FICHIER || path.join(__dirname, '..', 'data', 'frais.json');

const DEFAUT = { defaut: 0, commissionDefaut: 0, parSymbole: {} };

/**
 * Ordres de grandeur à VÉRIFIER chez son courtier — ce ne sont pas des mesures.
 * Ils servent seulement à pré-remplir l'écran ; l'owner doit saisir ses valeurs
 * réelles, sinon on remplace une ignorance par une supposition.
 */
const REFERENCES_A_VERIFIER = {
  frxXAUUSD: { spread: 0.30, commissionPct: 0 },
  frxXAGUSD: { spread: 0.03, commissionPct: 0 },
  frxEURUSD: { spread: 0.00012, commissionPct: 0 },
  frxGBPUSD: { spread: 0.00016, commissionPct: 0 },
  frxUSDJPY: { spread: 0.00016, commissionPct: 0 },
  frxAUDUSD: { spread: 0.00016, commissionPct: 0 },
  BTCUSDT: { spread: 0.01, commissionPct: 0.001 },
  ETHUSDT: { spread: 0.05, commissionPct: 0.001 },
  SOLUSDT: { spread: 0.01, commissionPct: 0.001 },
  XRPUSDT: { spread: 0.0002, commissionPct: 0.001 },
  PAXGUSDT: { spread: 0.50, commissionPct: 0.001 },
  R_75: { spread: 0.80, commissionPct: 0 },
  R_10: { spread: 0.25, commissionPct: 0 },
  BOOM500: { spread: 0.50, commissionPct: 0 },
  '1HZ100V': { spread: 0.50, commissionPct: 0 },
  OTC_FCHI: { spread: 1.00, commissionPct: 0 },
  OTC_SPC: { spread: 0.40, commissionPct: 0 }
};

let _cache = null;
let _mtime = -1;

function nombre(v, defaut = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : defaut;
}

function normaliser(brut) {
  const j = brut && typeof brut === 'object' ? brut : {};
  const parSymbole = {};
  const source = j.parSymbole && typeof j.parSymbole === 'object' ? j.parSymbole : {};
  for (const [sym, val] of Object.entries(source)) {
    if (!sym || val === null || val === undefined) continue;
    const o = typeof val === 'object' ? val : { spread: val };
    const e = { spread: nombre(o.spread, 0), commissionPct: nombre(o.commissionPct, 0) };
    // Une entrée à zéro est conservée : elle dit explicitement « ce symbole est
    // gratuit », ce qui n'est pas la même chose que « on ne sait pas ».
    parSymbole[String(sym)] = e;
  }
  return { defaut: nombre(j.defaut, 0), commissionDefaut: nombre(j.commissionDefaut, 0), parSymbole };
}

/** Configuration courante. Relue si le fichier a changé (édition à la main prise en compte). */
function configuration() {
  try {
    const st = fs.statSync(FICHIER);
    if (_cache && st.mtimeMs === _mtime) return _cache;
    const j = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
    _cache = normaliser(j);
    _mtime = st.mtimeMs;
    return _cache;
  } catch {
    // Fichier absent = aucun coût configuré. Ce n'est pas une erreur.
    _cache = _cache || normaliser(DEFAUT);
    return _cache;
  }
}

/** Écriture atomique, même raison que le journal : pas de JSON tronqué. */
function configurer(patch = {}) {
  const actuel = configuration();
  const suivant = normaliser({
    defaut: 'defaut' in patch ? patch.defaut : actuel.defaut,
    commissionDefaut: 'commissionDefaut' in patch ? patch.commissionDefaut : actuel.commissionDefaut,
    parSymbole: patch.parSymbole && typeof patch.parSymbole === 'object'
      ? patch.parSymbole
      : actuel.parSymbole
  });
  fs.mkdirSync(path.dirname(FICHIER), { recursive: true });
  const tmp = `${FICHIER}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(suivant, null, 2));
  fs.renameSync(tmp, FICHIER);
  _cache = suivant;
  try { _mtime = fs.statSync(FICHIER).mtimeMs; } catch { _mtime = -1; }
  return suivant;
}

/**
 * Coût d'un trade, en unités de prix.
 * @param {string} symbol
 * @param {number} entree prix d'entrée (sert à convertir la commission)
 * @returns {{spread:number, commission:number, total:number}}
 */
function fraisPour(symbol, entree) {
  const cfg = configuration();
  const perso = symbol && cfg.parSymbole[symbol];
  const spread = perso ? perso.spread : cfg.defaut;
  const commissionPct = perso ? perso.commissionPct : cfg.commissionDefaut;
  const commission = Number.isFinite(Number(entree)) && commissionPct
    ? commissionPct * Number(entree) * 2     // aller ET retour
    : 0;
  return {
    spread: +spread.toFixed(6),
    commission: +commission.toFixed(6),
    total: +(spread + commission).toFixed(6)
  };
}

/** Le même coût, exprimé en R (fraction du risque). */
function coutEnR(symbol, entree, risque) {
  const f = fraisPour(symbol, entree);
  const r = Math.abs(Number(risque) || 0);
  return { ...f, enR: r > 0 ? +(f.total / r).toFixed(4) : null };
}

/** Les frais sont-ils réellement configurés ? (sinon net = brut) */
function actifs() {
  const cfg = configuration();
  if (cfg.defaut > 0 || cfg.commissionDefaut > 0) return true;
  return Object.values(cfg.parSymbole).some(v => v.spread > 0 || v.commissionPct > 0);
}

/**
 * Coût TOTAL par trade qui annule l'espérance.
 *
 * Si le R net vaut `rBrut - cout/risque`, l'espérance nette s'annule quand
 * `cout = moyenne(rBrut) / moyenne(1/risque)`. C'est le seul chiffre qui dit
 * « jusqu'à quel spread ce système reste rentable » — et il ne dépend d'aucune
 * estimation, seulement des trades déjà enregistrés.
 *
 * @param {Array<{rBrut:number, risque:number}>} paires
 */
function coutCritique(paires) {
  const propres = (paires || []).filter(p =>
    Number.isFinite(Number(p.rBrut)) && Number(p.risque) > 0);
  if (!propres.length) return null;
  const moyenneR = propres.reduce((a, p) => a + Number(p.rBrut), 0) / propres.length;
  const moyenneInv = propres.reduce((a, p) => a + 1 / Number(p.risque), 0) / propres.length;
  if (!moyenneInv) return null;
  return +(moyenneR / moyenneInv).toFixed(6);
}

module.exports = {
  FICHIER, REFERENCES_A_VERIFIER, DEFAUT,
  configuration, configurer, fraisPour, coutEnR, actifs, coutCritique, normaliser
};
