/**
 * 5TRADE — Agent Observability & Trace Journal
 *
 * Assure la traçabilité complète des actions de l'Agent Autonome.
 * Enregistre noir sur blanc :
 *   - L'action demandée
 *   - Le niveau de traitement : COMPRIS | ENREGISTRÉ | PROGRAMMÉ | EXÉCUTÉ | REFUSÉ
 *   - Les souvenirs mobilisés
 *   - Les compétences (skills) invoquées
 *   - La preuve et l'accusé de réception
 */

const fs = require('fs');
const path = require('path');

const FICHIER_OBSERVABILITE = path.join(__dirname, '..', '..', 'data', 'agent-observabilite.json');

const STATUTS_TRAITEMENT = {
  COMPRIS: 'COMPRIS',
  ENREGISTRE: 'ENREGISTRE',
  PROGRAMME: 'PROGRAMME',
  EXECUTE: 'EXECUTE',
  REFUSE: 'REFUSE'
};

function chargerTraces() {
  try {
    if (fs.existsSync(FICHIER_OBSERVABILITE)) {
      const data = JSON.parse(fs.readFileSync(FICHIER_OBSERVABILITE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch {}
  return [];
}

/**
 * Enregistre une trace d'action dans le journal d'observabilité.
 * @param {object} p
 * @param {string} p.action Intitulé de l'action
 * @param {string} p.statut 'COMPRIS'|'ENREGISTRE'|'PROGRAMME'|'EXECUTE'|'REFUSE'
 * @param {string} [p.details] Explication ou contexte
 * @param {Array<string>} [p.souvenirsUtilises] IDs des souvenirs consultés
 * @param {Array<string>} [p.skillsInvoques] IDs des skills sollicités
 * @param {string} [p.preuve] Accusé formel ou hash de preuve
 */
function tracerAction({ action, statut, details = '', souvenirsUtilises = [], skillsInvoques = [], preuve = null }) {
  const traces = chargerTraces();
  const entree = {
    id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    horodatage: new Date().toISOString(),
    action,
    statut: Object.values(STATUTS_TRAITEMENT).includes(statut) ? statut : STATUTS_TRAITEMENT.COMPRIS,
    details,
    souvenirsUtilises,
    skillsInvoques,
    preuve: preuve || `Trace générée à ${new Date().toISOString()}`
  };

  traces.push(entree);
  const tronque = traces.slice(-1000);
  fs.mkdirSync(path.dirname(FICHIER_OBSERVABILITE), { recursive: true });
  fs.writeFileSync(FICHIER_OBSERVABILITE, JSON.stringify(tronque, null, 2), 'utf8');

  return entree;
}

/**
 * Récupère les dernières traces d'audit.
 */
function obtenirDernieresTraces(limite = 50) {
  const traces = chargerTraces();
  return traces.slice(-limite);
}

module.exports = {
  STATUTS_TRAITEMENT,
  tracerAction,
  obtenirDernieresTraces
};
