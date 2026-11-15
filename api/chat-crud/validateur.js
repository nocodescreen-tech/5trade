/**
 * 5trade — Chat CRUD : validateur.
 *
 * Toutes les commandes ne sont pas équivalentes. Le validateur classe les
 * actions par niveau de risque et exige des confirmations pour les
 * actions dangereuses.
 *
 * Niveaux :
 *   - lecture        : MONTRE, EXPLIQUE — jamais de confirmation
 *   - mineure        : MODIFIE paramètre dans les seuils (delta ≤ 5%)
 *   - structurelle   : ACTIVE/DÉSACTIVE stratégie, MODIFIE structure
 *   - destruction    : SUPPRIME — confirmation + grace period 24h
 *   - système        : MODIFIE risque global, SUPPRIME table — multi-confirmations
 */

const Ajusteur = require('../apprentissage/ajusteur-seuils');

/**
 * @param {{verbe:string, sujet:string, type?:string}} action
 * @returns {Promise<{niveau:string, confirmation_requise:boolean, raison?:string}>}
 */
async function evaluer(action) {
  const { verbe, sujet, type } = action;

  // Lecture : toujours OK
  if (['MONTRE', 'EXPLIQUE', 'AIDE'].includes(verbe)) {
    return { niveau: 'lecture', confirmation_requise: false };
  }
  if (verbe === 'APPRENDS') {
    return { niveau: 'lecture', confirmation_requise: false, raison: 'enregistrement en mémoire' };
  }

  // APPRENDS correction : pas de danger, juste un enregistrement
  if (verbe === 'APPRENDS' && type === 'correction') {
    return { niveau: 'lecture', confirmation_requise: false };
  }

  // CRÉE : dépend du domaine
  if (verbe === 'CRÉE') {
    if (/exception|r[èe]gle\s+interd/i.test(sujet)) {
      return { niveau: 'mineure', confirmation_requise: false, raison: 'exception ajoutée immédiatement, active dès maintenant' };
    }
    if (/strat[ée]gie/i.test(sujet)) {
      return { niveau: 'structurelle', confirmation_requise: true, raison: 'nouvelle stratégie — confirmer la création' };
    }
    return { niveau: 'mineure', confirmation_requise: false };
  }

  // MODIFIE : dépend de la cible
  if (verbe === 'MODIFIE') {
    if (/risque\s+global|capital\s+total|max\s+levier/i.test(sujet)) {
      return { niveau: 'système', confirmation_requise: true, raison: 'modification critique — confirmer' };
    }
    if (/strat[ée]gie/i.test(sujet)) {
      return { niveau: 'structurelle', confirmation_requise: true, raison: 'modification de stratégie — confirmer' };
    }
    // Modifie paramètre : valide via l'ajusteur
    const { extraireModification } = require('./parseur');
    const extrait = extraireModification(sujet);
    if (extrait && extrait.parametre && extrait.valeur !== null) {
      const proposition = await Ajusteur.proposer(extrait.parametre, extrait.valeur);
      if (proposition.statut === 'gele') {
        return { niveau: 'système', confirmation_requise: true, raison: proposition.raison };
      }
      if (proposition.statut === 'rejete') {
        return { niveau: 'rejete', confirmation_requise: false, raison: proposition.raison };
      }
      return {
        niveau: 'mineure',
        confirmation_requise: true,
        raison: `ajustement ${extrait.parametre} : ${extrait.valeur} — statut ${proposition.statut}`
      };
    }
    return { niveau: 'mineure', confirmation_requise: false };
  }

  // SUPPRIME : toujours destruction
  if (verbe === 'SUPPRIME') {
    return {
      niveau: 'destruction',
      confirmation_requise: true,
      raison: 'suppression — confirmer (grace 24h avant purge effective)'
    };
  }

  // ACTIVE/DÉSACTIVE : structurelle
  if (verbe === 'ACTIVE' || verbe === 'DÉSACTIVE') {
    return {
      niveau: 'structurelle',
      confirmation_requise: true,
      raison: `${verbe.toLowerCase()} ${sujet} — confirmer`
    };
  }

  return { niveau: 'inconnu', confirmation_requise: false, raison: 'verbe non reconnu' };
}

module.exports = { evaluer };
