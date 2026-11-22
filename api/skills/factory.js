/**
 * 5TRADE — Skill Factory
 *
 * Moteur de création, test en sandbox et installation de nouvelles compétences (skills)
 * pour l'Agent Autonome.
 *
 * Cycle de vie sécurisé :
 *  1. Spécification (contrat de compétences, actions, invariants).
 *  2. Analyse statique du code (interdiction d'accès système/process).
 *  3. Épreuve en sandbox (node:vm) avec tests unitaires automatisés.
 *  4. Installation atomique (SKILL.md + index.js) et enregistrement en mémoire.
 */

const fs = require('fs');
const path = require('path');
const { validerSkill, verifierCodeSource } = require('./validator');
const { chargerDansSandbox, executerMethodeSecurisee } = require('./sandbox');
const registry = require('./registry');

const DOSSIER_INSTALLES = path.join(__dirname, 'installed');

/**
 * Éprouve un code de skill dans la sandbox avant toute persistance.
 * @param {string} codeSource
 * @param {Array<{action?: string, params?: object, assertion: (res: any) => boolean}>} [tests=[]]
 * @returns {Promise<{ok: boolean, erreurs: string[], skill?: object}>}
 */
async function eprouverSkillDansSandbox(codeSource, tests = []) {
  const erreurs = [];

  // 1. Analyse statique
  const statique = verifierCodeSource(codeSource);
  if (!statique.securise) {
    return { ok: false, erreurs: statique.violations };
  }

  // 2. Compilation en sandbox
  const charge = chargerDansSandbox(codeSource);
  if (!charge.ok) {
    return { ok: false, erreurs: [charge.erreur] };
  }

  const skill = charge.exports;

  // 3. Validation de conformité des invariants
  const val = validerSkill(skill);
  if (!val.valide) {
    return { ok: false, erreurs: val.erreurs };
  }

  // 4. Exécution de tests de validation fonctionnelle
  if (Array.isArray(tests) && tests.length > 0) {
    for (let i = 0; i < tests.length; i++) {
      const t = tests[i];
      const params = t.params || (t.action ? { action: t.action } : {});
      const execRes = await executerMethodeSecurisee(skill.executer.bind(skill), [params, {}], 5000);
      if (!execRes.ok) {
        erreurs.push(`Test #${i + 1} en échec : ${execRes.erreur}`);
        continue;
      }
      if (typeof t.assertion === 'function') {
        try {
          const pass = t.assertion(execRes.resultat);
          if (!pass) erreurs.push(`Test #${i + 1} : assertion non vérifiée`);
        } catch (e) {
          erreurs.push(`Test #${i + 1} exception : ${e.message}`);
        }
      }
    }
  }

  return {
    ok: erreurs.length === 0,
    erreurs,
    skill
  };
}

/**
 * Crée, valide et installe un nouveau skill dans la plateforme.
 * @param {object} p
 * @param {string} p.id
 * @param {string} p.nom
 * @param {string} [p.version='1.0.0']
 * @param {string} p.description
 * @param {string} p.codeSource
 * @param {string} [p.documentation]
 * @param {Array} [p.tests]
 * @returns {Promise<{ok: boolean, id?: string, erreurs?: string[]}>}
 */
async function installerNouveauSkill({ id, nom, version = '1.0.0', description, codeSource, documentation, tests = [] }) {
  if (!id || !/^[a-z0-9_-]{3,50}$/.test(id)) {
    return { ok: false, erreurs: ['ID de skill invalide (3-50 car. alphanumériques minuscules avec tirets)'] };
  }

  // 1. Épreuve préalable obligatoire dans la sandbox
  const epreuve = await eprouverSkillDansSandbox(codeSource, tests);
  if (!epreuve.ok) {
    return { ok: false, erreurs: epreuve.erreurs };
  }

  // 2. Écriture sur disque dans son dossier dédié
  const dossierSkill = path.join(DOSSIER_INSTALLES, id);
  try {
    fs.mkdirSync(dossierSkill, { recursive: true });

    // Documentation SKILL.md
    const docMd = documentation || [
      '---',
      `name: ${id}`,
      `description: ${description}`,
      `version: ${version}`,
      'author: 5TRADE Autonomous Agent',
      '---',
      '',
      `# ${nom}`,
      '',
      description,
      '',
      '## Actions disponibles',
      ...(epreuve.skill.actions || []).map(a => `- \`${a}\``)
    ].join('\n');

    fs.writeFileSync(path.join(dossierSkill, 'SKILL.md'), docMd, 'utf8');
    fs.writeFileSync(path.join(dossierSkill, 'index.js'), codeSource, 'utf8');

    // 3. Enregistrement direct dans le registre
    registry.enregistrer(epreuve.skill);
    registry.activer(id);
    registry.charger();

    return {
      ok: true,
      id,
      version,
      nom
    };
  } catch (e) {
    return { ok: false, erreurs: [`Erreur d'écriture sur disque : ${e.message}`] };
  }
}

/**
 * Supprime un skill installé.
 */
function desinstallerSkill(id) {
  if (!id) return { ok: false, raison: 'ID manquant' };
  const dossierSkill = path.join(DOSSIER_INSTALLES, id);
  if (!fs.existsSync(dossierSkill)) {
    return { ok: false, raison: `Skill ${id} non trouvé sur le disque` };
  }
  try {
    fs.rmSync(dossierSkill, { recursive: true, force: true });
    if (typeof registry.supprimer === 'function') {
      registry.supprimer(id);
    } else {
      registry.desactiver(id);
    }
    return { ok: true, id };
  } catch (e) {
    return { ok: false, raison: e.message };
  }
}

module.exports = {
  eprouverSkillDansSandbox,
  installerNouveauSkill,
  desinstallerSkill
};
