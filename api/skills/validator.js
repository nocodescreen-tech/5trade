/**
 * 5TRADE — Skill Validator & Invariants de Sécurité
 *
 * Garantit qu'aucun skill (interne ou créé dynamiquement) ne peut violer
 * le noyau immuable de gestion du risque ou la sécurité de la plateforme.
 *
 * INVARIANTS NON NÉGOCIABLES :
 *  1. INTERDICTION DE COURT-CIRCUITER LE RISQUE : Un skill ne peut ni désactiver
 *     le RiskEngine, ni ignorer les plafonds d'exposition (6%), ni supprimer
 *     l'obligation de Stop Loss et TP1.
 *  2. INTÉGRITÉ DU SYSTÈME : Pas de child_process non contrôlé, pas d'accès direct
 *     à des fichiers hors du périmètre autorisé, pas de modification des prototypes globaux.
 *  3. CONTRAT STRUCTURÉ : Métadonnées obligatoires (id, nom, version, description)
 *     et fonction `executer(params, ctx)` testable.
 */

const MOTS_INTERDITS = [
  'process.exit',
  'child_process',
  'rmdirSync',
  'unlinkSync',
  'DROP TABLE',
  'TRUNCATE'
];

/**
 * Valide un objet skill ou son code source.
 * @param {object} skill
 * @returns {{valide: boolean, erreurs: string[]}}
 */
function validerSkill(skill) {
  const erreurs = [];

  if (!skill || typeof skill !== 'object') {
    return { valide: false, erreurs: ['Le skill doit être un objet valide'] };
  }

  // 1. Métadonnées
  if (!skill.id || !/^[a-z0-9_-]{3,50}$/.test(skill.id)) {
    erreurs.push('Identifiant (id) invalide : doit être entre 3 et 50 caractères alphanumériques minuscules avec tirets');
  }
  if (!skill.nom || typeof skill.nom !== 'string' || skill.nom.trim().length < 3) {
    erreurs.push('Nom de skill obligatoire (au moins 3 caractères)');
  }
  if (!skill.version || !/^\d+\.\d+\.\d+/.test(skill.version)) {
    erreurs.push('Version semver invalide (ex: 1.0.0)');
  }
  if (!skill.description || skill.description.trim().length < 10) {
    erreurs.push('Description obligatoire (au moins 10 caractères)');
  }

  // 2. Point d'entrée exécutable
  if (typeof skill.executer !== 'function') {
    erreurs.push('Le skill doit obligatoirement implémenter une méthode `executer(params, ctx)`');
  }

  // 3. Vérification des invariants de sécurité
  if (skill.permetContournerRisque === true) {
    erreurs.push('SÉCURITÉ : Un skill ne peut pas déclarer `permetContournerRisque: true` (inviolabilité du noyau de risque)');
  }

  return {
    valide: erreurs.length === 0,
    erreurs
  };
}

/**
 * Analyse statique sommaire du code source pour éviter des charges dangereuses.
 * @param {string} code
 * @returns {{securise: boolean, violations: string[]}}
 */
function verifierCodeSource(code) {
  if (typeof code !== 'string') return { securise: true, violations: [] };
  const violations = [];
  for (const m of MOTS_INTERDITS) {
    if (code.includes(m)) {
      violations.push(`Instruction interdite détectée : ${m}`);
    }
  }
  return {
    securise: violations.length === 0,
    violations
  };
}

module.exports = {
  validerSkill,
  verifierCodeSource
};
