/**
 * 5trade — MODÈLE EXPORTÉ (R attendu).
 *
 * Le problème résolu : le moteur produit des signaux de qualité très inégale et
 * les traite à égalité. Mesuré sur 6 mois et ~98 000 trades, un modèle de
 * gradient boosting retrouve un avantage STABLE (5 plis sur 5 positifs) en
 * prédisant le R net d'un trade. Ici on l'applique au direct.
 *
 * Pourquoi pas un micro-service Python : le direct doit rester local, hors
 * ligne, sans process à surveiller. Un ensemble d'arbres se sérialise
 * exactement — l'export a été vérifié à l'écart 4,9e-10 près, et le canonique
 * rejoue chaque fois 120 lignes réelles pour s'assurer que ce module ne dérive
 * pas de l'entraînement.
 *
 * TROIS RÈGLES :
 *  1. Les features sont calculées par la SPEC exportée avec le modèle, jamais
 *     réécrites ici. Deux implémentations écrites à la main divergent.
 *  2. Un marché absent du modèle ne reçoit AUCUNE prédiction (`null`) : une
 *     extrapolation silencieuse serait pire qu'une absence.
 *  3. Le modèle ne remplace pas les règles : il pondère. Les règles continuent
 *     de dire pourquoi ; le modèle dit combien ça vaut.
 *
 * Fichiers : models/modele-r.json (versionné), surchargeable par MODELE_FICHIER.
 */

const fs = require('fs');
const path = require('path');
const { aplatir } = require('./ligne-signal');

const FICHIER = process.env.MODELE_FICHIER
  || path.join(__dirname, '..', 'models', 'modele-r.json');

let cache = null;
let mtime = -1;

/** Un accès de chemin « a.b.c » qui rend `defaut` dès qu'un maillon manque. */
function chemin(objet, cle, defaut = null) {
  let courant = objet;
  for (const morceau of String(cle).split('.')) {
    if (!courant || typeof courant !== 'object' || !(morceau in courant)) return defaut;
    courant = courant[morceau];
  }
  return courant === null || courant === undefined ? defaut : courant;
}

const estNombre = v => typeof v === 'number' && Number.isFinite(v);

/**
 * Lecture d'un seuil textuel (« ≤ 40.63 », « ≥ 1,5 × ATR »).
 * Réplique EXACTE de `_nombre` côté Python : même expression, même nettoyage.
 * Une divergence ici ferait diverger la feature `ratio:` et le canonique le
 * verrait comme un écart de prédiction.
 */
function nombreDepuisTexte(txt) {
  if (txt === null || txt === undefined) return null;
  if (estNombre(txt)) return txt;
  const propre = String(txt).replace(/\u202f/g, '');
  const m = propre.match(/-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(',', '.')) : null;
}

function valeurFeature(item, ligne) {
  switch (item.genre) {
    case 'direct': {
      const v = ligne[item.champ];
      return estNombre(v) ? v : Number(item.defaut) || 0;
    }
    case 'compte': {
      const v = ligne[item.champ];
      return Array.isArray(v) ? v.length : 0;
    }
    case 'egal':
      return chemin(ligne, item.chemin) === item.valeur ? 1 : 0;
    case 'dummy': {
      const v = chemin(ligne, item.chemin);
      return v !== null && String(v) === String(item.valeur) ? 1 : 0;
    }
    case 'chemin_num': {
      const v = chemin(ligne, item.chemin);
      return estNombre(v) ? v : Number(item.defaut) || 0;
    }
    case 'atr_rel': {
      const atr = chemin(ligne, 'carte.atr', 0) || 0;
      const prix = chemin(ligne, 'carte.prix', 1) || 1;
      return Number(atr) / Number(prix);
    }
    case 'cond_ok':
    case 'cond_val':
    case 'cond_ratio': {
      const liste = Array.isArray(ligne.conditions) ? ligne.conditions : [];
      const c = liste.find(x => x && x.nom === item.nom);
      if (!c) return 0;
      if (item.genre === 'cond_ok') return c.ok ? 1 : 0;
      const num = estNombre(c.valeur) ? c.valeur : null;
      if (item.genre === 'cond_val') return num === null ? 0 : num;
      const seuil = nombreDepuisTexte(c.seuil);
      if (num === null || !seuil) return 0;
      return num / seuil;
    }
    default:
      return 0;
  }
}

/** Le vecteur de features, dans l'ORDRE exporté. */
function vecteur(modele, ligne) {
  return modele.spec.map(item => valeurFeature(item, ligne));
}

/**
 * Prédiction : base + somme des feuilles.
 * Le learning rate est DÉJÀ dans les feuilles (sklearn l'y incorpore) : le
 * réappliquer diviserait la prédiction — erreur mesurée lors de la mise au
 * point de l'export.
 */
function predireVecteur(modele, x) {
  let s = modele.base[0];
  for (const noeuds of modele.arbres) {
    let i = 0;
    // Garde : un index hors bornes signalerait un export abîmé. On sort la
    // valeur du noeud courant plutôt que de boucler à l'infini.
    for (let garde = 0; garde < 64; garde++) {
      const n = noeuds[i];
      if (!n) break;
      if (n.feuille) { s += n.valeur; break; }
      const v = x[n.f];
      if (!Number.isFinite(v)) { i = n.manquantGauche ? n.g : n.d; }
      else { i = v <= n.seuil ? n.g : n.d; }
    }
  }
  return s;
}

// ─── Chargement ──────────────────────────────────────────────────────────

/** Le modèle courant, relu si le fichier a changé (réentraînement à chaud). */
function modele() {
  try {
    const st = fs.statSync(FICHIER);
    if (cache && st.mtimeMs === mtime) return cache;
    const j = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
    if (!j || !Array.isArray(j.arbres) || !Array.isArray(j.spec) || !Array.isArray(j.base)) {
      return null;
    }
    cache = j;
    mtime = st.mtimeMs;
    return cache;
  } catch {
    return null;      // pas de modèle : le moteur continue de fonctionner sans lui
  }
}

function disponible() {
  return !!modele();
}

function marches() {
  const m = modele();
  return m && m.meta && Array.isArray(m.meta.marches) ? m.meta.marches : [];
}

/**
 * R attendu pour un SIGNAL BRUT de `detecterTout` (forme vivante).
 * La mise en forme passe par `ligne-signal.aplatir` : la même fonction que
 * l'écriture du jeu de données, donc pas de divergence possible.
 * @returns {null|{rAttendu:number|null, prediction?:number, marche:string, version:number,
 *                 horsPerimetre:boolean}}
 */
function noter(signal, symbol, carte) {
  const m = modele();
  if (!m) return null;
  // Règle 2 : pas d'extrapolation sur un marché que le modèle n'a jamais vu.
  const connus = marches();
  if (connus.length && symbol && !connus.includes(symbol)) {
    return { rAttendu: null, marche: symbol || null, version: m.version || 1, horsPerimetre: true };
  }
  return noterLigne(aplatir(signal, carte), symbol);
}

/**
 * R attendu pour une LIGNE DÉJÀ MISE EN FORME (forme du jeu de données).
 * C'est le chemin du test de parité : on lui donne les lignes réellement
 * écrites par `dataset.js` et on compare à la sortie de sklearn.
 */
function noterLigne(ligne, symbol) {
  const m = modele();
  if (!m) return null;
  const connus = marches();
  if (connus.length && symbol && !connus.includes(symbol)) {
    return { rAttendu: null, marche: symbol || null, version: m.version || 1, horsPerimetre: true };
  }
  const x = vecteur(m, ligne);
  const brut = predireVecteur(m, x);
  return {
    // `rAttendu` est arrondi pour l'affichage et l'API ; `prediction` reste la
    // valeur exacte, seule comparable à la sortie de sklearn dans le test de parité.
    rAttendu: +brut.toFixed(4),
    prediction: brut,
    marche: symbol || null,
    version: m.version || 1,
    horsPerimetre: false
  };
}

/** Ce que le modèle sait de lui-même — pour l'écran et le diagnostic. */
function info() {
  const m = modele();
  if (!m) return { disponible: false, raison: `aucun modèle lisible dans ${FICHIER}` };
  return {
    disponible: true,
    fichier: FICHIER,
    version: m.version || 1,
    cree: m.cree || null,
    formule: m.formule || null,
    arbres: m.arbres.length,
    features: m.features ? m.features.length : null,
    marches: marches(),
    seuil: seuil(),
    meta: m.meta || null
  };
}

/**
 * Seuil d'acceptation du R attendu.
 *
 * 0 par défaut : on ne refuse que l'espérance négative, et on laisse tout le
 * reste au trader. `MODELE_SEUIL` (ou `options.modeleSeuil`) permet d'appliquer
 * le décile supérieur — la configuration validée en walk-forward — au prix de
 * ~90 % de signaux en moins. C'est une décision de produit, donc elle se règle.
 */
function seuil() {
  const env = process.env.MODELE_SEUIL;
  // Valeur spéciale : « top10 » applique le seuil du décile supérieur mesuré à
  // l'entraînement, sans avoir à recopier un nombre.
  if (env === 'top10') {
    const t = seuilTop10();
    return t === null ? 0 : t;
  }
  const n = Number(env);
  return Number.isFinite(n) ? n : 0;
}

/** Le seuil du décile supérieur, tel que mesuré à l'entraînement (informatif). */
function seuilTop10() {
  const m = modele();
  return m && m.meta && Number.isFinite(m.meta.seuil_top10) ? m.meta.seuil_top10 : null;
}

module.exports = {
  FICHIER, modele, disponible, marches, noter, noterLigne, info, seuil, seuilTop10,
  vecteur, predireVecteur, valeurFeature, nombreDepuisTexte
};
