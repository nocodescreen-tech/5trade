/**
 * 5TRADE — Registre & Gestionnaire des Compétences (Skills Registry)
 *
 * Permet à l'agent autonome d'explorer, charger, activer et exécuter
 * des compétences modulaires (skills) spécialisées.
 *
 * Chaque compétence réside dans son propre dossier sous `api/skills/installed/<id>/`
 * comprenant :
 *  - `SKILL.md` (documentation et instructions cognitives)
 *  - `index.js` (implémentation exécutable validée)
 */

const fs = require('fs');
const path = require('path');
const { validerSkill } = require('./validator');
const { executerMethodeSecurisee } = require('./sandbox');

const DOSSIER_INSTALLES = path.join(__dirname, 'installed');
const FICHIER_ETAT = path.join(__dirname, '..', '..', 'data', 'skills-registry.json');

const competences = new Map();
const etatActif = new Map(); // id -> boolean

function chargerEtat() {
  try {
    if (fs.existsSync(FICHIER_ETAT)) {
      const data = JSON.parse(fs.readFileSync(FICHIER_ETAT, 'utf8'));
      if (typeof data === 'object' && data !== null) {
        for (const [k, v] of Object.entries(data)) {
          etatActif.set(k, !!v);
        }
      }
    }
  } catch {}
}

function sauvegarderEtat() {
  try {
    const obj = {};
    for (const [k, v] of etatActif.entries()) {
      obj[k] = v;
    }
    fs.mkdirSync(path.dirname(FICHIER_ETAT), { recursive: true });
    fs.writeFileSync(FICHIER_ETAT, JSON.stringify(obj, null, 2));
  } catch {}
}

/**
 * Enregistre une compétence en mémoire après validation stricte.
 */
function enregistrer(skill) {
  const v = validerSkill(skill);
  if (!v.valide) {
    throw new Error(`Compétence non valide (${(skill && skill.id) || 'sans id'}) : ${v.erreurs.join(', ')}`);
  }
  competences.set(skill.id, skill);
  if (!etatActif.has(skill.id)) {
    etatActif.set(skill.id, skill.actif !== false);
  }
  return true;
}

/**
 * Charge un skill depuis un dossier de manière sécurisée (analyse préalable).
 */
function chargerDossierSkill(dossierSkill, nomDossier) {
  const { compile, ID } = require('./declarative');
  if (!ID.test(nomDossier)) return false;
  const dossierStat = fs.lstatSync(dossierSkill);
  if (!dossierStat.isDirectory() || dossierStat.isSymbolicLink()) return false;
  let skillObj;
  if (nomDossier === 'forex-session-monitor') {
    const indexPath = path.join(dossierSkill, 'index.js');
    const stat = fs.lstatSync(indexPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    // Only the built-in, version-controlled module is trusted native code.
    skillObj = require(indexPath);
  } else {
    const jsonPath = path.join(dossierSkill, 'skill.json');
    if (!fs.existsSync(jsonPath)) {
      console.warn('[Skills] Ancien skill JavaScript ignoré : ' + nomDossier);
      return false;
    }
    const stat = fs.lstatSync(jsonPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768) return false;
    skillObj = compile(JSON.parse(fs.readFileSync(jsonPath,'utf8')));
  }
  if (skillObj.id !== nomDossier) return false;
  enregistrer(skillObj);
  return true;
}

/**
 * Initialise le registre et charge toutes les compétences installées.
 */
function charger() {
  chargerEtat();
  if (!fs.existsSync(DOSSIER_INSTALLES)) {
    fs.mkdirSync(DOSSIER_INSTALLES, { recursive: true });
    return competences.size;
  }

  const entrees = fs.readdirSync(DOSSIER_INSTALLES, { withFileTypes: true });
  for (const ent of entrees) {
    if (ent.isDirectory()) {
      const dossierSkill = path.join(DOSSIER_INSTALLES, ent.name);
      try {
        chargerDossierSkill(dossierSkill, ent.name);
      } catch (e) {
        console.warn(`[Skills] Erreur chargement ${ent.name} : ${e.message}`);
      }
    }
  }
  return competences.size;
}

/**
 * Liste les compétences disponibles avec leur statut.
 */
function lister() {
  if (competences.size === 0) charger();
  const liste = [];
  for (const [id, skill] of competences.entries()) {
    liste.push({
      id: skill.id,
      nom: skill.nom,
      version: skill.version,
      description: skill.description,
      actif: etatActif.get(id) !== false,
      actions: Array.isArray(skill.actions) ? skill.actions : []
    });
  }
  return liste;
}

/**
 * Récupère une compétence par son ID.
 */
function obtenir(id) {
  if (competences.size === 0) charger();
  return competences.get(id) || null;
}

/**
 * Active une compétence.
 */
function activer(id) {
  if (!competences.has(id)) {
    return { ok: false, raison: `Compétence « ${id} » inconnue` };
  }
  etatActif.set(id, true);
  sauvegarderEtat();
  return { ok: true, id, actif: true };
}

/**
 * Désactive une compétence.
 */
function desactiver(id) {
  if (!competences.has(id)) {
    return { ok: false, raison: `Compétence « ${id} » inconnue` };
  }
  etatActif.set(id, false);
  sauvegarderEtat();
  return { ok: true, id, actif: false };
}

/**
 * Exécute une compétence de manière sécurisée (avec timeout strict).
 */
async function executer(id, params = {}, ctx = {}) {
  const skill = obtenir(id);
  if (!skill) {
    return { ok: false, raison: `Compétence « ${id} » introuvable` };
  }
  if (etatActif.get(id) === false) {
    return { ok: false, raison: `La compétence « ${id} » est désactivée` };
  }

  // Exécution sécurisée avec protection anti-blocage (timeout 10s)
  const res = await executerMethodeSecurisee(skill.executer.bind(skill), [params, ctx], 10000);
  if (!res.ok) {
    return {
      ok: false,
      skillId: id,
      raison: `Erreur d'exécution du skill ${id} : ${res.erreur}`
    };
  }

  return {
    ok: true,
    skillId: id,
    resultat: res.resultat
  };
}

/**
 * Supprime une compétence du registre et de l'état persisté.
 */
function supprimer(id) {
  competences.delete(id);
  etatActif.delete(id);
  sauvegarderEtat();
  return true;
}

module.exports = {
  charger,
  enregistrer,
  supprimer,
  lister,
  obtenir,
  activer,
  desactiver,
  executer
};
