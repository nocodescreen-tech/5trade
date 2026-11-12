/**
 * Routeur de moteurs par classe de marché.
 *
 * Constat qui justifie ce fichier : le scan appliquait `signals.detect()` à tous
 * les instruments. Les seuils changeaient avec le profil, la logique non. Un
 * indice synthétique Deriv, une paire Forex et un indice réel étaient donc lus
 * avec la même grille — alors que leur fonctionnement n'a rien de commun.
 *
 * Ce routeur ne prétend pas que tous les moteurs existent. Il dit la vérité :
 *   - `specialise: true`  → la classe a un moteur qui lui est propre ;
 *   - `specialise: false` → aucun moteur dédié n'existe encore, et l'appelant
 *     doit le SAVOIR au lieu de croire à une analyse spécialisée.
 *
 * Un moteur par classe, quand il existe, expose `analyser(closes, meta)`.
 */

const Synthetique = require('./synthetique');

const REGISTRE = {
  synthetique: {
    id: 'synthetique',
    libelle: 'Indices synthétiques Deriv',
    version: '1.0.0',
    specialise: true,
    // Ce que ce moteur apporte que les autres n'ont pas.
    apports: ['volatilité réalisée', 'régime statistique', 'part de sauts', 'autocorrélation'],
    // Ce qu'il ne fait pas — écrit noir sur blanc.
    limites: ['ne prédit pas la direction', "n'utilise ni session, ni volume, ni actualité macro"],
    analyser: Synthetique.analyser
  },
  forex: {
    id: 'forex', libelle: 'Forex', version: null, specialise: false,
    motif: "aucun moteur Forex dédié : sessions, corrélations de devises et calendrier ne sont pas encore assemblés dans un moteur propre",
    apports: [], limites: [], analyser: null
  },
  indices: {
    id: 'indices', libelle: 'Indices réels', version: null, specialise: false,
    motif: "aucun moteur d'indice réel : horaires de séance, gaps d'ouverture et volume ne sont pas encore assemblés",
    apports: [], limites: [], analyser: null
  },
  crypto: {
    id: 'crypto', libelle: 'Crypto', version: null, specialise: false,
    motif: 'aucun moteur crypto dédié : liquidité, funding et volatilité 24/7 ne sont pas encore assemblés',
    apports: [], limites: [], analyser: null
  },
  metaux: {
    id: 'metaux', libelle: 'Métaux', version: null, specialise: false,
    motif: 'aucun moteur métaux dédié : sensibilité au dollar et coûts de portage non assemblés',
    apports: [], limites: [], analyser: null
  },
  energies: {
    id: 'energies', libelle: 'Énergies', version: null, specialise: false,
    motif: 'aucun moteur énergies dédié : stocks, offre et événements non assemblés',
    apports: [], limites: [], analyser: null
  },
  inconnu: {
    id: 'inconnu', libelle: 'Inconnu', version: null, specialise: false,
    motif: "classe de marché non identifiée : aucun moteur ne peut être choisi",
    apports: [], limites: [], analyser: null
  }
};

/** Moteur de la classe, ou un descripteur honnête disant qu'il n'y en a pas. */
function pour(classe) {
  return REGISTRE[classe] || REGISTRE.inconnu;
}

/** Analyse par le moteur de la classe. Null si aucun moteur dédié n'existe. */
function analyser(classe, closes, meta = {}) {
  const m = pour(classe);
  if (!m.analyser) return null;
  return { ...m.analyser(closes, meta), moteurId: m.id, moteurVersion: m.version };
}

/** Vue pour l'écran : quelles classes sont réellement couvertes. */
function etat() {
  return Object.values(REGISTRE).map(m => ({
    classe: m.id, libelle: m.libelle, version: m.version,
    specialise: !!m.specialise, motif: m.motif || null,
    apports: m.apports, limites: m.limites
  }));
}

module.exports = { pour, analyser, etat, REGISTRE };
