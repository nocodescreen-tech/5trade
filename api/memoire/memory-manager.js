/**
 * 5TRADE — Memory Manager Unifié
 *
 * Distingue et structure les souvenirs de l'Agent Autonome avec traçabilité complète :
 *   - FAIT_TEMPORAIRE       : information éphémère avec TTL (ex: volatilité du jour)
 *   - PREFERENCE_PERMANENTE : consigne utilisateur durable (ex: interdiction d'un symbole, max risque)
 *   - INSTRUCTION_TACTIQUE  : règle de trading ou de session (ex: ne pas trader pendant CPI)
 *   - CORRECTION_HUMAINE    : feedback explicite de l'utilisateur (ex: « faux signal hier sur EURUSD »)
 *   - CONNAISSANCE_VALIDEE  : fait prouvé par backtest ou données hors échantillon
 *
 * Chaque souvenir dispose de :
 *   { id, type, contenu, source, portee, creeLe, expireLe, statut, preuve }
 */

const fs = require('fs');
const path = require('path');
const preferences = require('./preferences');

const TYPES_MEMOIRE = {
  FAIT_TEMPORAIRE: 'fait_temporaire',
  PREFERENCE_PERMANENTE: 'preference_permanente',
  INSTRUCTION_TACTIQUE: 'instruction_tactique',
  CORRECTION_HUMAINE: 'correction_humaine',
  CONNAISSANCE_VALIDEE: 'connaissance_validee'
};

const FICHIER_MEMOIRE_UNIFIEE = path.join(__dirname, '..', '..', 'data', 'memoire-unifiee.json');

/**
 * Charge tous les souvenirs unifiés.
 */
function chargerSouvenirs() {
  try {
    if (fs.existsSync(FICHIER_MEMOIRE_UNIFIEE)) {
      const data = JSON.parse(fs.readFileSync(FICHIER_MEMOIRE_UNIFIEE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch {}
  return [];
}

/**
 * Persiste les souvenirs unifiés sur disque avec garantie d'écriture.
 */
function sauvegarderSouvenirs(souvenirs) {
  fs.mkdirSync(path.dirname(FICHIER_MEMOIRE_UNIFIEE), { recursive: true });
  fs.writeFileSync(FICHIER_MEMOIRE_UNIFIEE, JSON.stringify(souvenirs, null, 2), 'utf8');
}

/**
 * Enregistre un souvenir unifié avec typage et preuve d'enregistrement.
 * @param {object} p
 * @param {string} p.type 'fait_temporaire'|'preference_permanente'|'instruction_tactique'|'correction_humaine'|'connaissance_validee'
 * @param {string} p.contenu Description de la consigne ou du souvenir
 * @param {string} [p.source='utilisateur'] Origine ('utilisateur', 'backtest', 'moteur', 'telegram')
 * @param {string} [p.portee='globale'] 'globale' | symbole spécifique (ex: 'EURUSD')
 * @param {number} [p.ttlMs=null] Durée de vie en ms (uniquement pour faits temporaires)
 * @param {object} [p.metadonnees={}] Données complémentaires
 * @returns {Promise<{ ok: boolean, id: string, type: string, horodatage: string, statut: string, preuve: string }>}
 */
async function memoriser({ type, contenu, source = 'utilisateur', portee = 'globale', ttlMs = null, metadonnees = {} }) {
  if (!contenu || typeof contenu !== 'string') {
    throw new Error('Contenu de mémoire manquant');
  }

  const typeValide = Object.values(TYPES_MEMOIRE).includes(type) ? type : TYPES_MEMOIRE.PREFERENCE_PERMANENTE;
  const maintenant = new Date();
  const id = `mem_${maintenant.getTime()}_${Math.random().toString(36).slice(2, 7)}`;
  const expireLe = (typeValide === TYPES_MEMOIRE.FAIT_TEMPORAIRE && ttlMs)
    ? new Date(maintenant.getTime() + ttlMs).toISOString()
    : null;

  const souvenir = {
    id,
    type: typeValide,
    contenu: contenu.trim(),
    source,
    portee,
    creeLe: maintenant.toISOString(),
    expireLe,
    statut: 'actif',
    metadonnees,
    preuve: `Enregistré le ${maintenant.toISOString()} par ${source} (portée: ${portee})`
  };

  const tous = chargerSouvenirs();
  tous.push(souvenir);
  sauvegarderSouvenirs(tous);

  // Si c'est une préférence permanente ou une instruction tactique, synchroniser avec preferences.js
  if (typeValide === TYPES_MEMOIRE.PREFERENCE_PERMANENTE || typeValide === TYPES_MEMOIRE.INSTRUCTION_TACTIQUE) {
    await preferences.enregistrer({
      categorie: portee === 'globale' ? 'regles_trading' : 'symboles',
      cle: id,
      valeur: contenu.trim(),
      source,
      commentaire: `Synchronisé via MemoryManager (${typeValide})`
    });
  }

  return {
    ok: true,
    id,
    type: typeValide,
    horodatage: souvenir.creeLe,
    statut: 'actif',
    preuve: souvenir.preuve
  };
}

/**
 * Récupère les souvenirs actifs non expirés.
 * @param {string} [typeFiltre=null]
 * @returns {Array<object>}
 */
function obtenirSouvenirsActifs(typeFiltre = null) {
  const maintenant = Date.now();
  const tous = chargerSouvenirs();
  return tous.filter(s => {
    if (s.statut !== 'actif') return false;
    if (s.expireLe && new Date(s.expireLe).getTime() < maintenant) return false;
    if (typeFiltre && s.type !== typeFiltre) return false;
    return true;
  });
}

module.exports = {
  TYPES_MEMOIRE,
  memoriser,
  obtenirSouvenirsActifs,
  chargerSouvenirs
};
