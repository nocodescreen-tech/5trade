/**
 * 5trade — résolution des dossiers de données.
 *
 * Deux réalités de déploiement, apprises en production :
 *
 *   1. Certains PaaS montent le code en LECTURE SEULE. Multer crée son dossier
 *      d'upload au chargement du module : le serveur mourait sur
 *      `EROFS: read-only file system, mkdir '/app/api/uploads'` avant même
 *      d'écouter. Idem pour les stratégies écrites dans knowledge-base/.
 *
 *   2. Sur une build depuis Git, un volume neuf est vide : si on écrit ailleurs
 *      que dans le dépôt, les stratégies et le lexique versionnés n'y sont pas.
 *
 * On résout donc chaque dossier, dans cet ordre :
 *   a. la variable d'environnement (DATA_DIR, KNOWLEDGE_BASE_DIR, UPLOADS_DIR)
 *      si elle est vraiment inscriptible ;
 *   b. le dossier du dépôt, s'il est inscriptible (cas local) ;
 *   c. un repli inscriptible partout : <tmp>/5trade/<nom> ;
 * et on recopie la graine du dépôt quand la cible retenue est vide.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Copie récursive sans écraser (Node ≥ 16.7 : fs.cpSync). */
function copierGraine(source, cible) {
  try {
    fs.cpSync(source, cible, { recursive: true, force: false, errorOnExist: false });
    return true;
  } catch {
    return false;
  }
}

function inscriptible(dossier) {
  try {
    fs.mkdirSync(dossier, { recursive: true });
    // accessSync(W_OK) ne suffit PAS : sur un montage en lecture seule (EROFS),
    // il répond « accessible en écriture » d'après les bits de permission alors
    // que toute écriture échoue. Multer, lui, ne pardonne pas : mkdir au
    // chargement du module = serveur mort avant d'écouter. On écrit donc pour
    // de vrai, puis on efface.
    const sonde = path.join(dossier, `.ecriture-${process.pid}-${Date.now()}`);
    fs.writeFileSync(sonde, 'ok');
    fs.unlinkSync(sonde);
    return true;
  } catch {
    return false;
  }
}

function resoudre(variable, dossierDepot, nom) {
  const repli = path.join(os.tmpdir(), '5trade', nom);
  const candidats = [process.env[variable], dossierDepot, repli].filter(Boolean);

  for (const candidat of candidats) {
    const dossier = path.resolve(candidat);
    if (!inscriptible(dossier)) continue;

    // Graine : la cible retenue n'est pas le dossier du dépôt et elle est vide.
    const source = path.resolve(dossierDepot);
    if (dossier !== source && fs.existsSync(source)) {
      let vide = true;
      try { vide = fs.readdirSync(dossier).length === 0; } catch { vide = true; }
      if (vide) copierGraine(source, dossier);
    }
    return dossier;
  }
  return path.resolve(repli);
}

const DATA_DIR = resoudre('DATA_DIR', path.join(ROOT, 'data'), 'data');
const KNOWLEDGE_BASE_DIR = resoudre('KNOWLEDGE_BASE_DIR', path.join(ROOT, 'knowledge-base'), 'knowledge-base');
const DOCUMENTS_DIR = path.join(KNOWLEDGE_BASE_DIR, 'documents');
const UPLOADS_DIR = resoudre('UPLOADS_DIR', path.join(__dirname, 'uploads'), 'uploads');

// Les modules qui lisent process.env.DATA_DIR directement (db.js) doivent voir
// le dossier réellement choisi, pas la valeur brute d'origine.
process.env.DATA_DIR = DATA_DIR;
process.env.KNOWLEDGE_BASE_DIR = KNOWLEDGE_BASE_DIR;
process.env.UPLOADS_DIR = UPLOADS_DIR;

module.exports = { DATA_DIR, KNOWLEDGE_BASE_DIR, DOCUMENTS_DIR, UPLOADS_DIR, resoudre };
