/**
 * 5trade — Chat CRUD : routeur.
 *
 * Prend une action parsée { verbe, sujet } et trouve le module concerné.
 * Le routeur ne fait rien lui-même — il renvoie une fonction à exécuter.
 */

const cmdTrades = require('./commandes/trades');
const cmdStrategies = require('./commandes/strategies');
const cmdParametres = require('./commandes/parametres');
const cmdScenarios = require('./commandes/scenarios');
const cmdApprentissage = require('./commandes/apprentissage');
const cmdMemoire = require('./commandes/memoire');
const cmdSysteme = require('./commandes/systeme');

/**
 * Détecte le domaine à partir du sujet.
 * @param {string} sujet
 * @returns {'trades'|'strategies'|'parametres'|'scenarios'|'apprentissage'|'memoire'|'systeme'|null}
 */
function detecterDomaine(sujet) {
  if (!sujet) return null;
  const s = sujet.toLowerCase();

  if (/\btrade[s]?\b|position[s]?|tp|stop|issue|r[ée]alis[ée]/i.test(s)) return 'trades';
  if (/strat[ée]gie|momentum|breakout|reversal|trend|price\s*action|retour\s+moyenne/i.test(s)) return 'strategies';
  if (/sc[ée]nario|en\s+attente|expir/i.test(s)) return 'scenarios';
  if (/apprenti|appris|journal|post-mortem|walk-forward|shadow/i.test(s)) return 'apprentissage';
  if (/croyance|exception|fait|m[ée]moire|ce que tu sais|comp[ée]tence/i.test(s)) return 'memoire';
  if (/syst[èe]me|sant[ée]|uptime|module|version|config/i.test(s)) return 'systeme';
  if (/stop|atr|rsi|seuil|risque|frais|capital|levier|param[èe]tre/i.test(s)) return 'parametres';

  return null;
}

/**
 * @param {{verbe:string, sujet:string, type?:string}} action
 * @returns {{domaine:string, handler:Function}|{domaine:'inconnu', raison:string}}
 */
function router(action) {
  // Cas spéciaux : sujets codés
  if (action.sujet === 'etat_systeme') {
    return { domaine: 'systeme', handler: cmdSysteme.etat };
  }
  if (action.sujet === 'memoire') {
    return { domaine: 'memoire', handler: cmdMemoire.etat };
  }
  if (action.sujet === 'apprentissage') {
    return { domaine: 'apprentissage', handler: cmdApprentissage.dernierJournal };
  }

  const domaine = detecterDomaine(action.sujet);
  if (!domaine) {
    return { domaine: 'inconnu', raison: `domaine non reconnu pour « ${action.sujet} »` };
  }

  const handlers = {
    trades: {
      MONTRE: cmdTrades.lister,
      EXPLIQUE: cmdTrades.expliquer,
      MODIFIE: cmdTrades.modifier,
      SUPPRIME: cmdTrades.supprimer,
    },
    strategies: {
      MONTRE: cmdStrategies.lister,
      CRÉE: cmdStrategies.creer,
      MODIFIE: cmdStrategies.modifier,
      SUPPRIME: cmdStrategies.supprimer,
      ACTIVE: cmdStrategies.activer,
      DÉSACTIVE: cmdStrategies.desactiver,
    },
    parametres: {
      MONTRE: cmdParametres.lister,
      MODIFIE: cmdParametres.modifier,
    },
    scenarios: {
      MONTRE: cmdScenarios.lister,
      SUPPRIME: cmdScenarios.supprimer,
    },
    apprentissage: {
      MONTRE: cmdApprentissage.lister,
      EXPLIQUE: cmdApprentissage.expliquer,
    },
    memoire: {
      MONTRE: cmdMemoire.lister,
      CRÉE: cmdMemoire.creerException,
      SUPPRIME: cmdMemoire.supprimerException,
    },
    systeme: {
      MONTRE: cmdSysteme.etat,
      EXPLIQUE: cmdSysteme.diagnostic,
    },
  };

  const handler = handlers[domaine] && handlers[domaine][action.verbe];
  if (!handler) {
    return {
      domaine,
      raison: `verbe ${action.verbe} non supporté pour le domaine ${domaine}`
    };
  }

  return { domaine, handler };
}

module.exports = { router, detecterDomaine };
