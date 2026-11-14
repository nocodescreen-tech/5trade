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

// ── Conversation libre ────────────────────────────────────────────────────
// Le chat n'est PAS un menu de commandes : c'est un assistant ouvert à toutes
// les conversations. Ce qui ne correspond à aucune commande structurée part
// vers l'IA de l'application (NVIDIA NIM, cascade) avec l'historique récent.
// Ce qui touche aux données du système reste exécuté par les commandes : une
// réponse IA ne remplace jamais une lecture réelle (aucun chiffre inventé).
const PROMPT_SYSTEME = [
  "Tu es le pilote de 5trade, la plateforme de trading assistée par IA de René.",
  "Tu discutes librement : tu réponds à TOUTE question, trading ou non, en français,",
  "de façon directe et concise, sans emphase et sans emoji.",
  "",
  "Ce que tu sais du système : moteurs d'analyse (structure, niveaux, confluence",
  "multi-timeframe), stratégies (achat/vente validées par règles), scénarios en",
  "attente, trades et leur issue en R, mémoire persistante (faits, croyances,",
  "exceptions), apprentissage walk-forward quotidien, gestion du risque et frais.",
  "",
  "Règles absolues :",
  "1. N'invente jamais une donnée du système (prix, trade, stratégie, performance,",
  "   état d'un module). Ces données se lisent par une commande ; si on te les",
  "   demande, dis quelle commande les affiche au lieu de deviner.",
  "2. Tu ne prétends jamais avoir exécuté une action : les actions passent par les",
  "   commandes, avec confirmation. Si on veut agir, donne la commande exacte.",
  "3. Pas de conseil financier personnalisé ; tu expliques, tu ne certifies pas un gain.",
  "4. Ne recopie JAMAIS un message précédent de la conversation : réponds avec tes",
  "   propres mots, même si la question est courte (« hi », « ok », « pourquoi ? »).",
  "   Si on te salue, réponds en une phrase et rappelle en une ligne ce que tu sais faire.",
  "",
  "Commandes que l'utilisateur peut taper :",
  "  montre l'état du système · montre les trades · montre les stratégies",
  "  montre les scénarios en attente · montre les paramètres",
  "  qu'est-ce que tu sais · qu'est-ce que tu as appris cette semaine ?",
  "  crée une stratégie … · crée une exception : ne pas trader EURUSD vendredi après 16h",
  "  modifie le stop ATR à 1.2 sur XAUUSD · active la stratégie momentum",
  "  désactive … · supprime … · pourquoi tu as pris ce trade #847 ? · aide",
].join('\n');

/**
 * Réponse libre par l'IA, avec l'historique récent comme contexte.
 * @param {string} message
 * @param {object} ctx  { utilisateur, ia? }
 * @param {string} [raison]  pourquoi la commande structurée n'a pas répondu
 */
async function repondreLibre(message, ctx, raison) {
  if (typeof ctx.ia !== 'function') {
    return {
      texte: `Je n'ai pas reconnu cette commande et l'IA n'est pas branchée.\n` +
             `Reformule ou tape « aide ».\nMessage : « ${message} »`,
      action: null
    };
  }

  // Historique récent : c'est lui qui rend la conversation continue. La question
  // en cours n'y est pas encore (la route l'écrit après coup).
  let historique = [];
  try {
    const H = require('./historique');
    const l = await H.lister({ limite: 12 });
    historique = (l || [])
      // Les anciennes réponses « je n'ai pas reconnu » n'apprennent rien au
      // modèle et l'incitaient à les recopier : on ne les renvoie pas.
      .filter(m => m && m.texte && !/^Je n'ai pas reconnu cette commande/i.test(String(m.texte)))
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: String(m.texte).slice(0, 1500)
      }));
  } catch { /* sans historique, on répond quand même */ }

  const messages = [
    { role: 'system', content: PROMPT_SYSTEME },
    ...historique,
    { role: 'user', content: String(message).slice(0, 4000) }
  ];

  try {
    const texte = await ctx.ia(messages, { maxTokens: 900, route: 'chat' });
    const propre = String(texte || '').trim();
    if (!propre) throw new Error('réponse vide');
    return { texte: propre, action: null, ia: true, raison: raison || null };
  } catch (e) {
    return {
      texte: `IA indisponible : ${e.message}\n` +
             `En attendant, tape « aide » pour la liste des commandes.`,
      action: null, ia: true, erreurIA: e.message
    };
  }
}

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
    // Aucune commande structurée : conversation libre, l'IA répond.
    return await repondreLibre(message, ctx, 'aucune commande reconnue');
  }
  if (action.verbe === 'INCONNU') {
    return await repondreLibre(message, ctx, 'message illisible');
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
    return await repondreLibre(action.brut || `${action.verbe} ${action.sujet}`, ctx, route.raison);
  }
  if (!route.handler) {
    return await repondreLibre(action.brut || `${action.verbe} ${action.sujet}`, ctx, route.raison);
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
