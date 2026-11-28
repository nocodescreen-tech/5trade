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
  "Tu es le copilote intelligent et autonome de 5trade, la plateforme avancée de trading de René.",
  "Tu réponds à TOUS les messages avec précision, fluidité et proactivité, en français.",
  "Tu ne te contentes pas d'attendre des commandes rigides : tu comprends les intentions de l'utilisateur,",
  "tu pilotes l'ensemble des modules (analyse, moteurs, stratégies, risque, mémoire, graphiques, apprentissage),",
  "tu proposes des actions claires, et tu résumes l'état des marchés avec rigueur.",
  "",
  "Ce que tu maîtrises :",
  "- Moteurs d'analyse (structure SMC, Fair Value Gaps, Order Blocks, Liquidity Sweeps, Choch, multi-timeframe).",
  "- Stratégies et profils de trade (activation, désactivation, règles, seuils de force).",
  "- Journal d'exécution, suivi des trades ouverts, calcul du R et des gains.",
  "- Scénarios d'attente et surveillance dynamique des prix.",
  "- Gestion du risque (stops ATR, leviers, frais, drawdowns).",
  "- Mémoire continue et apprentissage continu (walk-forward quotidien, post-mortem des signaux).",
  "",
  "Directives de communication :",
  "1. Sois direct, pédagogique et orienté action. Quand l'utilisateur demande une analyse ou une action,",
  "   fournis les observations techniques précises et exécute ou indique immédiatement l'action correspondante.",
  "2. Ne dis jamais 'je ne suis qu'une interface de commande' : tu es le copilote complet de la plateforme.",
  "3. Respecte toujours le capital et rappelle la rigueur de gestion du risque sans emphase superflue."
].join('\n');

/**
 * Réponse libre par l'IA, avec l'historique récent comme contexte.
 * @param {string} message
 * @param {object} ctx  { utilisateur, ia? }
 * @param {string} [raison]  pourquoi la commande structurée n'a pas répondu
 */

// ── Contexte temps réel ──────────────────────────────────────────────────────
// L'IA ne doit pas seulement répondre : elle doit SAVOIR. Ce bloc lui donne
// l'état réel au moment de la question — positions ouvertes avec leurs niveaux,
// plans d'attente en cours, derniers événements (stop touché, TP atteint,
// expiration). Tout vient des modules, rien n'est supposé.
const heureCourte = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const num = (x) => (Number.isFinite(Number(x))
  ? (Math.abs(Number(x)) >= 1000 ? Number(x).toFixed(2) : Number(x).toFixed(5)) : '—');

async function contexteTempsReel() {
  const lignes = [];

  // 1. Positions ouvertes (journal des signaux).
  try {
    const J = require('../engine/journal-signaux');
    const journal = J.charger();
    const ouvertes = (journal.signaux || []).filter(s => s.resultat === 'ouvert');
    lignes.push(`Positions simulées du journal (pas des ordres courtier) : ${ouvertes.length}`);
    for (const s of ouvertes.slice(0, 8)) {
      const age = s.at ? ((Date.now() - s.at) / 3600000).toFixed(1) : '?';
      lignes.push(`- ${s.symbol || '?'} ${s.timeframe || '?'} ${s.sens} : entrée ${num(s.entree)}, `
        + `stop ${num(s.stop)}, objectifs ${(s.objectifs || []).map(num).join(' / ') || '—'}, `
        + `ouverte depuis ${age} h${s.atteintTP1 ? ', TP1 déjà atteint' : ''}`);
    }
    if (!ouvertes.length) lignes.push('- aucune');
  } catch { /* le contexte est un bonus : son absence ne bloque pas la réponse */ }

  // 2. Plans d'attente en cours (scénarios).
  try {
    const Scenarios = require('../scenarios');
    const enAttente = await Scenarios.lister({ statut: 'en_attente', limite: 5 });
    lignes.push(`Scénarios en attente : ${enAttente.length}`);
    for (const s of enAttente) {
      const tp2Str = s.tp2 ? `, TP2 ${num(s.tp2)}` : '';
      lignes.push(`- ${s.instrument} ${s.timeframe || ''} ${s.direction} si le prix atteint `
        + `${num(s.niveauEntree)} (stop ${num(s.stop)}, TP1 ${num(s.tp1)}${tp2Str})`);
    }
  } catch { /* idem */ }

  // 3. Marchés actifs & Dernier scan exécuté
  try {
    const InstrumentsActifs = require('../core/instruments-actifs');
    const Scan = require('../delivery/scan');
    const actifs = InstrumentsActifs.obtenirActifs();
    lignes.push(`Marchés surveillés enregistrés : ${actifs.length ? actifs.map(a => (a.symbol || String(a)) + (a.tf ? ' '+a.tf : '')).join(', ') : 'aucun'}`);
    const ds = Scan.dernierScan();
    if (ds && ds.dernier) {
      const d = ds.dernier;
      lignes.push(`Dernier scan automatique (${d.at || '?'}) : ${d.marches} marché(s) sur [${(d.tfs || [d.tf]).join(', ')}], `
        + `${d.signaux} signal(aux), stratégies évaluées : [${(d.strategies || []).join(', ') || 'générique'}]`);
      if (d.erreurs && d.erreurs.length) {
        lignes.push(`Erreurs / blocages scan : ${d.erreurs.slice(0, 3).join(' · ')}`);
      }
    } else {
      lignes.push('Dernier scan automatique : aucun cycle exécuté pour le moment.');
    }
  } catch { /* ignorer */ }

  // 4. Calendrier économique & Filtre Macro (Heure de Kinshasa WAT)
  try {
    const Fund = require('../sources/fundamentals');
    const cal = await Fund.filtreCalendrier('frxXAUUSD', { strict:true });
    lignes.push(`Filtre macro USD : ${cal.verifie ? (cal.bloque ? 'BLOQUÉ' : 'vérifié') : 'NON VÉRIFIÉ — aucune autorisation'} ; ${cal.detail || ''}`);
  } catch { /* ignorer */ }

  // 5. Consignes et préférences persistées en mémoire
  try {
    const Preferences = require('../memoire/preferences');
    const prefs = await Preferences.lister();
    if (prefs && prefs.length) {
      lignes.push(`Consignes persistées en mémoire (${prefs.length}) :`);
      for (const p of prefs.slice(0, 5)) {
        lignes.push(`- [${p.categorie || 'règle'}] ${p.contenu || p.consigne || 'contenu indisponible'}`);
      }
    }
  } catch { /* ignorer */ }

  // 6. Derniers événements publiés (stop touché, objectifs, expirations).
  try {
    const Flux = require('./flux');
    const r = Flux.resume(8);
    if (r) lignes.push('Derniers événements :\n' + r);
  } catch { /* idem */ }

  lignes.push('Exécution courtier : désactivée. Les observations prospectives ne sont pas des ordres. Les skills générés nécessitent une revue humaine.');
  try { const M = require('../moteurs'); lignes.push('Couverture moteurs : '+M.etat().map(m=>m.classe+': '+m.niveau).join(', ')); } catch { lignes.push('Couverture moteurs indisponible'); }
  return lignes.join('\n');
}

async function repondreLibre(message, ctx, raison) {
  if (typeof ctx.ia !== 'function') {
    return {
      texte: `Je n'ai pas reconnu cette commande et l'IA n'est pas branchée.\n` +
             `Reformule ou tape « aide ».\nMessage : « ${message} »`,
      action: null
    };
  }

  // Historique conversationnel : on charge jusqu'à 50 messages récents pour une continuité fluide
  let historique = [];
  try {
    const H = require('./historique');
    const l = await H.lister({ limite: 50 });
    historique = (l || [])
      // Les anciennes réponses « je n'ai pas reconnu » n'apprennent rien au
      // modèle et l'incitaient à les recopier : on ne les renvoie pas.
      .filter(m => m && m.texte && !/^Je n'ai pas reconnu cette commande/i.test(String(m.texte)))
      // Les événements (stop touché, TP, expiration) sont déjà fournis dans le
      // bloc d'état ci-dessous : les rejouer comme des tours de conversation
      // ferait croire que l'assistant les a « dits » dans cet ordre.
      .filter(m => m.verbe !== 'ÉVÉNEMENT')
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: String(m.texte).slice(0, 2000)
      }));
  } catch { /* sans historique, on répond quand même */ }

  const etat = await contexteTempsReel();
  const messages = [
    { role: 'system', content: PROMPT_SYSTEME },
    ...(etat ? [{ role: 'system',
      content: `État réel du système à ${heureCourte(Date.now())} (source : modules, jamais inventé) :\n${etat}` }] : []),
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

// Confirmations en attente — PERSISTÉES, pas en mémoire.
// Symptôme rapporté : « Confirmer ? (oui/non) » puis « oui » → « Aucune action en
// attente de confirmation. » à répétition. La file vivait dans une Map : un
// redémarrage du serveur (ou deux requêtes servies par deux instances) suffisait
// à perdre l'action proposée. Une action proposée doit survivre à la seconde qui
// suit, sinon la confirmation est un bouton décoratif.
const fs = require('fs');
const path = require('path');

const DUREE_CONFIRMATION_MS = 15 * 60 * 1000;
const FICHIER_CONFIRMATIONS = () =>
  process.env.CHAT_CONFIRMATIONS_FICHIER
  || path.join(process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'chat-confirmations.json');

function lireConfirmations() {
  try {
    const j = JSON.parse(fs.readFileSync(FICHIER_CONFIRMATIONS(), 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch { return {}; }
}

function ecrireConfirmations(doc) {
  const fichier = FICHIER_CONFIRMATIONS();
  const tmp = `${fichier}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
    fs.renameSync(tmp, fichier);          // écriture atomique : jamais de JSON tronqué
  } catch (e) {
    // Disque indisponible : on ne bloque pas l'action, on le dit.
    console.error('[chat] confirmations non persistées :', e.message);
  }
}

const cleDe = ctx => ctx.utilisateur || 'anon';

function poserConfirmation(ctx, action) {
  const doc = lireConfirmations();
  doc[cleDe(ctx)] = { action, timestamp: Date.now() };
  ecrireConfirmations(doc);
}

/** Retire et rend l'action en attente, si elle existe et n'est pas périmée. */
function prendreConfirmation(ctx) {
  const doc = lireConfirmations();
  const cle = cleDe(ctx);
  const entree = doc[cle];
  if (!entree) return null;
  delete doc[cle];
  ecrireConfirmations(doc);
  if (!entree.timestamp || Date.now() - entree.timestamp > DUREE_CONFIRMATION_MS) return null;
  return entree.action || null;
}

function annulerConfirmation(ctx) {
  const doc = lireConfirmations();
  const cle = cleDe(ctx);
  if (!doc[cle]) return false;
  delete doc[cle];
  ecrireConfirmations(doc);
  return true;
}

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
    const action = prendreConfirmation(ctx);
    if (!action) return { texte: 'Aucune action en attente de confirmation.' };
    return await executerAction(action, { ...ctx, confirmed: true });
  }
  if (/^(non|annuler?|no|cancel)$/i.test(message.trim())) {
    if (annulerConfirmation(ctx)) return { texte: 'Action annulée.' };
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
    poserConfirmation(ctx, action);
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
 * Purge les confirmations périmées. Elles le sont de toute façon à la lecture ;
 * cette fonction sert à ne pas laisser traîner un fichier qui grossit.
 */
function nettoyerConfirmations(maxAgeMs = DUREE_CONFIRMATION_MS) {
  const doc = lireConfirmations();
  const maintenant = Date.now();
  let purgees = 0;
  for (const [cle, val] of Object.entries(doc)) {
    if (!val || !val.timestamp || maintenant - val.timestamp > maxAgeMs) { delete doc[cle]; purgees++; }
  }
  if (purgees) ecrireConfirmations(doc);
  return purgees;
}

module.exports = { executer, nettoyerConfirmations };
