'use strict';

// Runtime-generated JavaScript is not trusted code. Store proposals as inert
// JSON; installation requires a reviewed source change and isolated testing.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { DATA_DIR } = require('../core/dossiers');

async function eprouverSkillDansSandbox() {
  return { ok: false, erreurs: ['Exécution de code généré suspendue : environnement isolé non disponible.'] };
}

async function installerNouveauSkill(input = {}) {
  const { id, nom, version = '1.0.0', description, codeSource, documentation } = input;
  if (typeof id !== 'string' || !/^[a-z0-9_-]{3,50}$/.test(id) ||
      typeof codeSource !== 'string' || !codeSource.trim() ||
      Buffer.byteLength(codeSource) > 100000) {
    return { ok: false, erreurs: ['Identifiant ou code source invalide.'] };
  }
  if (typeof nom !== 'string' || typeof description !== 'string' ||
      typeof version !== 'string' || nom.length > 200 ||
      description.length > 10000 || !/^\d+\.\d+\.\d+$/.test(version) ||
      (documentation !== undefined && (typeof documentation !== 'string' || documentation.length > 50000))) {
    return { ok: false, erreurs: ['Métadonnées invalides.'] };
  }
  const proposalId = crypto.randomUUID();
  const dir = path.join(DATA_DIR, 'skill-proposals');
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(dir, proposalId + '.json'), JSON.stringify({
      proposalId, id, nom, version, description, codeSource, documentation,
      status: 'pending_review', createdAt: new Date().toISOString()
    }, null, 2), { flag: 'wx', mode: 0o600 });
    return { ok: false, proposalSaved: true, proposalId, id,
      erreurs: ['Proposition enregistrée. Installation et exécution non autorisées avant revue et tests isolés.'] };
  } catch (error) {
    return { ok: false, erreurs: ['Échec de persistance de la proposition : ' + error.message] };
  }
}

function desinstallerSkill() {
  return { ok: false, raison: 'Les compétences déployées sont gérées par revue de code ; utiliser la désactivation.' };
}

module.exports = { eprouverSkillDansSandbox, installerNouveauSkill, desinstallerSkill };
