/**
 * 5TRADE — Autonomous Scheduler Persistant
 *
 * Gère les automatisations et tâches récurrentes de l'Agent Autonome
 * avec persistance sur disque, protection anti-doublon (idempotence)
 * et reprise après redémarrage du serveur.
 *
 * Tâches typiques :
 *   - Clôture Forex préventive du vendredi
 *   - Réouverture Forex du dimanche soir
 *   - Briefing quotidien de session
 *   - Vérification des événements macro à fort impact (CPI / NFP / FOMC)
 */

const fs = require('fs');
const path = require('path');

const FICHIER_TACHES = path.join(__dirname, '..', '..', 'data', 'scheduler-tasks.json');
const FICHIER_JOURNAL = path.join(__dirname, '..', '..', 'data', 'scheduler-journal.json');

function chargerTaches() {
  try {
    if (fs.existsSync(FICHIER_TACHES)) {
      const data = JSON.parse(fs.readFileSync(FICHIER_TACHES, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch {}
  return [];
}

function sauvegarderTaches(taches) {
  fs.mkdirSync(path.dirname(FICHIER_TACHES), { recursive: true });
  fs.writeFileSync(FICHIER_TACHES, JSON.stringify(taches, null, 2), 'utf8');
}

function chargerJournal() {
  try {
    if (fs.existsSync(FICHIER_JOURNAL)) {
      const data = JSON.parse(fs.readFileSync(FICHIER_JOURNAL, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch {}
  return [];
}

function enregistrerExecution(tacheId, resultat, erreur = null) {
  const journal = chargerJournal();
  const entree = {
    tacheId,
    horodatage: new Date().toISOString(),
    succes: !erreur,
    resultat: resultat || null,
    erreur: erreur ? String(erreur.message || erreur) : null
  };
  journal.push(entree);
  // Garder les 500 dernières exécutions
  const tronque = journal.slice(-500);
  fs.mkdirSync(path.dirname(FICHIER_JOURNAL), { recursive: true });
  fs.writeFileSync(FICHIER_JOURNAL, JSON.stringify(tronque, null, 2), 'utf8');
}

/**
 * Enregistre ou met à jour une tâche programmée.
 */
function enregistrerTache({ id, description, frequence, prochaineExecution, active = true, action, donnees = {} }) {
  if (!id) throw new Error('ID de tâche manquant');
  const taches = chargerTaches();
  const index = taches.findIndex(t => t.id === id);

  const tache = {
    id,
    description: description || id,
    frequence: frequence || 'personnalisee',
    prochaineExecution: prochaineExecution || new Date().toISOString(),
    derniereExecution: null,
    active: active !== false,
    action: action || 'notification',
    donnees
  };

  if (index >= 0) {
    taches[index] = { ...taches[index], ...tache };
  } else {
    taches.push(tache);
  }

  sauvegarderTaches(taches);
  return { ok: true, tache };
}

/**
 * Récupère les tâches prêtes à être exécutées.
 */
function obtenirTachesEnAttente(maintenant = new Date()) {
  const tNow = maintenant.getTime();
  const taches = chargerTaches();
  return taches.filter(t => t.active && t.prochaineExecution && new Date(t.prochaineExecution).getTime() <= tNow);
}

/**
 * Marque une tâche comme exécutée et calcule la prochaine échéance.
 */
function acquitterTache(id, nouvelleProchaine = null, resultat = null, erreur = null) {
  const taches = chargerTaches();
  const index = taches.findIndex(t => t.id === id);
  if (index >= 0) {
    taches[index].derniereExecution = new Date().toISOString();
    taches[index].prochaineExecution = nouvelleProchaine;
    if (!nouvelleProchaine) taches[index].active = false;
    sauvegarderTaches(taches);
  }
  enregistrerExecution(id, resultat, erreur);
}

module.exports = {
  chargerTaches,
  enregistrerTache,
  obtenirTachesEnAttente,
  acquitterTache,
  chargerJournal
};
