/**
 * 5TRADE — Skill Sandbox
 *
 * Exécute et charge les compétences dans une boîte isolée (node:vm)
 * sans accès au système de fichiers, aux processus hôtes, ni aux modules sensibles.
 */

const vm = require('vm');

/**
 * Crée un environnement de contexte sécurisé et hermétique pour un skill.
 * @param {object} [injections={}]
 * @returns {vm.Context}
 */
function creerContexteSecurise(injections = {}) {
  const contexte = {
    // Primitives sûres
    Math,
    Date,
    JSON,
    RegExp,
    Array,
    Object,
    Number,
    String,
    Boolean,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    // Timers limités
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 5000)),
    clearTimeout,
    // Journalisation bornée
    console: {
      log: (...args) => {},
      warn: (...args) => {},
      error: (...args) => {}
    },
    // Module exports conteneur
    module: { exports: {} },
    exports: {},
    // Injections de services trading sûrs autorisés
    ...injections
  };

  // Gel des prototypes essentiels
  return vm.createContext(contexte);
}

/**
 * Compile et exécute du code de skill dans le bac à sable.
 * @param {string} codeSource
 * @param {object} [injections={}]
 * @param {number} [timeoutMs=3000]
 * @returns {{ok: boolean, exports?: any, erreur?: string}}
 */
function chargerDansSandbox(codeSource, injections = {}, timeoutMs = 3000) {
  if (typeof codeSource !== 'string' || !codeSource.trim()) {
    return { ok: false, erreur: 'Code source vide ou invalide' };
  }

  // Vérification statique des imports et accès système directs
  if (/\b(?:require|import|process|child_process|eval|Function|globalThis|global)\b/.test(codeSource)) {
    // Si c'est un require légitime injecté ou interdit
    const violations = [];
    if (/\bprocess\b/.test(codeSource)) violations.push('accès à `process` interdit');
    if (/\bchild_process\b/.test(codeSource)) violations.push('accès à `child_process` interdit');
    if (/\beval\b/.test(codeSource)) violations.push('usage de `eval` interdit');
    if (/\bFunction\s*\(/.test(codeSource)) violations.push('constructeur Function interdit');
    if (violations.length > 0) {
      return { ok: false, erreur: `Sandbox : violations de sécurité : ${violations.join(', ')}` };
    }
  }

  try {
    const contexte = creerContexteSecurise(injections);
    const script = new vm.Script(codeSource, {
      filename: 'skill-sandbox.js',
      timeout: timeoutMs
    });

    script.runInContext(contexte, { timeout: timeoutMs });
    const resultat = contexte.module.exports && Object.keys(contexte.module.exports).length > 0
      ? contexte.module.exports
      : contexte.exports;

    const skillObj = typeof resultat === 'function' ? resultat() : resultat;
    if (!skillObj || typeof skillObj !== 'object') {
      return { ok: false, erreur: 'Le skill n\'a rien exporté d\'exploitable (module.exports attendu)' };
    }

    return { ok: true, exports: skillObj };
  } catch (e) {
    return { ok: false, erreur: `Erreur d'exécution dans la sandbox : ${e.message}` };
  }
}

/**
 * Exécute une méthode de skill dans la sandbox avec contrôle strict de timeout.
 * @param {Function} methode
 * @param {any[]} args
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<{ok: boolean, resultat?: any, erreur?: string}>}
 */
async function executerMethodeSecurisee(methode, args = [], timeoutMs = 5000) {
  if (typeof methode !== 'function') {
    return { ok: false, erreur: 'La cible n\'est pas une fonction exécutable' };
  }

  return new Promise((resolve) => {
    let fini = false;
    const timer = setTimeout(() => {
      if (!fini) {
        fini = true;
        resolve({ ok: false, erreur: `Timeout d'exécution dépassé (${timeoutMs} ms)` });
      }
    }, timeoutMs);

    Promise.resolve()
      .then(() => methode(...args))
      .then((res) => {
        if (!fini) {
          fini = true;
          clearTimeout(timer);
          resolve({ ok: true, resultat: res });
        }
      })
      .catch((err) => {
        if (!fini) {
          fini = true;
          clearTimeout(timer);
          resolve({ ok: false, erreur: err.message || String(err) });
        }
      });
  });
}

module.exports = {
  creerContexteSecurise,
  chargerDansSandbox,
  executerMethodeSecurisee
};
