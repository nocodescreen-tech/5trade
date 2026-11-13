/**
 * 5trade — Chat CRUD : exécuteur central.
 *
 * Prend une action parsée, la valide, demande confirmation si nécessaire,
 * exécute, trace dans l'audit, et formate la réponse.
 *
 * C'est le seul point d'entrée public :
 *   const { executer } = require('./chat-crud');
 *   const r = await executer('modifie le stop ATR à 1.2 sur XAUUSD', { utilisateur: 'rene' });
 */

const Parseur = require('./parseur');
const Routeur = require('./routeur');
const Validateur = require('./validateur');
const Auditeur = require('./auditeur');
const Repondeur = require('./repondeur');

// File d'attente des confirmations en attente.
// Clé = empreinte du message original, valeur = action à confirmer.
const confirmationsEnAttente = new Map();

/**
 * @param {string} message   texte brut tapé par l'utilisateur
 * @param {object} ctx       { utilisateur, ip, confirmationPour ? }
 * @returns {Promise<{texte:string, action?:object, audit?:object}>}
 */
async function executer(message, ctx = {}) {
  if (!message || !message.trim()) {
    return { texte: 'Commande vide. Tape « aide » pour la liste.' };
  }

  // Aide
  if (/^(aide|help|commandes)$/i.test(message.trim())) {
    return { texte: Repondeur.aide() };
  }

  // Confirmation d'une action précédente
  if (/^(oui|ok|confirmer?|yes)$/i.test(message.trim())) {
    const cle = ctx.utilisateur || 'anon';
    const enAttente = confirmationsEnAttente.get(cle);
    if (!enAttente) return { texte: 'Aucune action en attente de confirmation.' };
    confirmationsEnAttente.delete(cle);
    return await executerAction(enAttente.action, { ...ctx, confirmed: true });
  }
  if (/^(non|annuler?|no|cancel)$/i.test(message.trim())) {
    const cle = ctx.utilisateur || 'anon';
    if (confirmationsEnAttente.has(cle)) {
      confirmationsEnAttente.delete(cle);
      return { texte: 'Action annulée.' };
    }
    return { texte: 'Rien à annuler.' };
  }

  // Parser
  const action = Parseur.parser(message);
  if (action.verbe === 'LLM') {
    // En production : appel à NVIDIA NIM pour parser le message
    return {
      texte: `Je n'ai pas reconnu cette commande. Reformule ou tape « aide ».\n` +
             `Message : « ${message} »`
    };
  }
  if (action.verbe === 'INCONNU') {
    return { texte: 'Commande non reconnue. Tape « aide ».' };
  }

  return await executerAction(action, ctx);
}

async function executerAction(action, ctx) {
  // Valider
  const validation = await Validateur.evaluer(action);
  if (validation.niveau === 'rejete') {
    return { texte: `Action rejetée : ${validation.raison}`, action, validation };
  }

  // Confirmation requise ?
  if (validation.confirmation_requise && !ctx.confirmed) {
    const cle = ctx.utilisateur || 'anon';
    confirmationsEnAttente.set(cle, { action });
    return {
      texte: Repondeur.formater({
        confirmation_requise: true,
        raison: validation.raison,
        detail: { verbe: action.verbe, sujet: action.sujet }
      }, action),
      action,
      validation
    };
  }

  // Router
  const route = Routeur.router(action);
  if (route.domaine === 'inconnu') {
    return {
      texte: `Domaine non reconnu : ${route.raison}. Tape « aide » pour voir les commandes.`,
      action
    };
  }
  if (!route.handler) {
    return {
      texte: `Verbe ${action.verbe} non supporté pour ce domaine (${route.raison || 'raison inconnue'}).`,
      action
    };
  }

  // Exécuter
  let resultat;
  try {
    resultat = await route.handler(action.sujet, ctx);
  } catch (e) {
    resultat = { erreur: e.message };
  }

  // Auditer
  const audit = await Auditeur.tracer({
    acteur: ctx.utilisateur || 'anon',
    action: action.verbe,
    cible: action.sujet,
    detail: { domaine: route.domaine, niveau: validation.niveau, resultat },
    succes: !(resultat && resultat.erreur),
    niveau: validation.niveau,
  });

  // Répondre
  const texte = Repondeur.formater(resultat, action);
  return { texte, action, resultat, audit };
}

/**
 * Nettoie les confirmations expirées (à appeler périodiquement).
 */
function nettoyerConfirmations(maxAgeMs = 5 * 60 * 1000) {
  const maintenant = Date.now();
  for (const [cle, val] of confirmationsEnAttente.entries()) {
    if (val.timestamp && maintenant - val.timestamp > maxAgeMs) {
      confirmationsEnAttente.delete(cle);
    }
  }
}

module.exports = { executer, nettoyerConfirmations };
