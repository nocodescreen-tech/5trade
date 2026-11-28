'use strict';

/**
 * 5trade — Chat CRUD : Commandes d'audit et de surveillance réelle du copilote.
 * Répond avec des faits prouvés et mesurés aux 5 questions critiques :
 * 1. « Quels marchés surveilles-tu ? » (marches_surveilles)
 * 2. « Pourquoi aucun signal sur XAUUSD / instrument ? » (pourquoi_pas_signal)
 * 3. « Est-ce que le CPI bloque l'or / USD ? » (blocage_cpi)
 * 4. « Pourquoi je n'ai rien reçu sur Telegram ? » (statut_telegram)
 * 5. « Qu'est-ce que tu as mémorisé / préférences ? » (preferences_memorisees)
 */

const InstrumentsActifs = require('../../core/instruments-actifs');
const Scan = require('../../delivery/scan');
const Fundamentals = require('../../sources/fundamentals');
const NotificationTracker = require('../../delivery/notification-tracker');
const Preferences = require('../../memoire/preferences');
const DecisionEngine = require('../../engine/DecisionEngine');
const Market = require('../../sources/market');

/**
 * 1. Quels marchés surveilles-tu ?
 * Compare la sélection enregistrée avec ce qui a réellement été scanné au dernier cycle.
 */
async function marchesSurveilles() {
  const enregistres = InstrumentsActifs.obtenirActifs();
  const ds = Scan.dernierScan();
  const dernier = ds && ds.dernier ? ds.dernier : null;

  const lignes = ['📊 **Surveillance des marchés :**'];
  lignes.push(`- **Sélection enregistrée persistante :** ${enregistres.length ? enregistres.map(a => typeof a === 'string' ? a : `${a.symbol} (${a.provider}, ${a.tf})`).join(', ') : 'Aucun instrument actif (scan suspendu)'}`);
  
  if (dernier) {
    lignes.push(`- **Dernier scan exécuté :** ${dernier.at} (${dernier.marches} marchés traités, durée ${dernier.dureeMs || 0} ms)`);
    lignes.push(`- **Unités de temps réelles :** [${(dernier.tfs || [dernier.tf]).join(', ')}]`);
    lignes.push(`- **Stratégies évaluées :** [${(dernier.strategies || []).join(', ') || 'Moteur générique'}]`);
    lignes.push(`- **Signaux détectés :** ${dernier.signaux}`);

    // Détection d'un écart éventuel
    if (enregistres.length > 0 && dernier.marches > 0) {
      if (dernier.marches > enregistres.length) {
        lignes.push(`⚠️ *Écart constaté :* Le dernier scan a évalué plus d'instruments que la sélection active stricte.`);
      } else {
        lignes.push(`Le nombre de marchés traités ne dépasse pas la sélection ; les identités exactes restent à comparer.`);
      }
    }
  } else {
    lignes.push('- **Dernier scan :** Aucun cycle n\'a encore tourné depuis le démarrage.');
  }

  return { texte: lignes.join('\n') };
}

/**
 * 2. Pourquoi aucun signal sur XAUUSD (ou autre) ?
 * Exécute une évaluation directe du moteur pour donner la condition précise qui manque.
 */
async function pourquoiPasSignal(sujet = '') {
  const matchSym = sujet.match(/\b(xauusd|eurusd|btcusd|usdjpy|gbpusd|volatility\s*\d+|crash\s*\d+|boom\s*\d+)\b/i);
  const sym = matchSym ? matchSym[1].toUpperCase().replace(/\s+/g, '') : 'XAUUSD';
  const matchTf = sujet.match(/\b(1m|5m|15m|30m|1h|4h|1d)\b/i);
  const tf = matchTf ? matchTf[1] : '5m';

  const lignes = [`🔍 **Diagnostic du signal pour ${sym} en ${tf} :**`];
  try {
    const candlesRes = await Market.getCandles(sym, tf, 200);
    const candles = candlesRes.candles || [];
    if (candles.length < 20) {
      lignes.push(`- ❌ Données insuffisantes ou marché fermé (${candles.length} bougies reçues).`);
      return { texte: lignes.join('\n') };
    }

    const dec = DecisionEngine.decider(candles, { symbol: sym, timeframe: tf, verifierSession: true }, { timeframe: tf });
    lignes.push(`- **Décision du moteur :** \`${dec.decision}\``);
    lignes.push(`- **Motif principal :** ${dec.raison || 'Aucune anomalie majeure'}`);
    
    if (dec.statutSession && !dec.statutSession.ouvert) {
      lignes.push(`- 🛑 **Blocage de séance :** ${dec.statutSession.raison}`);
    } else {
      if (dec.conditionsManquantes && dec.conditionsManquantes.length) {
        lignes.push(`- **Conditions manquantes :**\n  * ${dec.conditionsManquantes.join('\n  * ')}`);
      }
      if (dec.trace && dec.trace.etapes) {
        const etapesEchouees = dec.trace.etapes.filter(e => e.statut === 'echec' || e.statut === 'invalide');
        if (etapesEchouees.length) {
          lignes.push(`- **Étapes non validées dans l'entonnoir :**`);
          for (const e of etapesEchouees.slice(0, 3)) {
            lignes.push(`  * ${e.nom || e.etape} : ${e.raison || 'Non satisfaite'}`);
          }
        }
      }
    }
  } catch (e) {
    lignes.push(`- ⚠️ Erreur lors de l'évaluation : ${e.message}`);
  }

  return { texte: lignes.join('\n') };
}

/**
 * 3. Est-ce que le CPI bloque l'or / USD ?
 * Consulte le calendrier et le résultat du filtre en heure de Kinshasa (WAT).
 */
async function blocageCpi() {
  const verdictUSD = await Fundamentals.newsImminente('USD', 30);

  const lignes = ['📅 **Impact macroéconomique (annonces USD majeures) sur XAUUSD :**'];
  lignes.push(`- **État du filtre :** ${!verdictUSD.verifie ? '**NON VÉRIFIÉ — calendrier indisponible**' : verdictUSD.bloque ? '🚫 **FILTRE MACRO BLOQUANT (Événement majeur)**' : 'Aucune annonce majeure dans la fenêtre (autres filtres nécessaires)'}`);
  lignes.push(`- **Phase temporelle :** \`${verdictUSD.phase || 'Neutre'}\``);
  lignes.push(`- **Heure de Kinshasa (WAT · UTC+1) :** ${verdictUSD.heureKinshasa || (verdictUSD.verifie ? 'Aucune annonce imminente' : 'Inconnue')}`);
  lignes.push(`- **Délai :** ${verdictUSD.delaiMin !== null && verdictUSD.delaiMin !== undefined ? `${verdictUSD.delaiMin} minute(s)` : 'N/A'}`);
  if (verdictUSD.news) {
    lignes.push(`- **Événement cible :** ${verdictUSD.news.titre} (Impact : ${verdictUSD.news.impact.toUpperCase()})`);
  }
  if (!verdictUSD.verifie) {
    lignes.push(`- ⚠️ *Note :* La source de données du calendrier est indisponible ou non synchronisée.`);
  }

  return { texte: lignes.join('\n') };
}

/**
 * 4. Pourquoi je n'ai rien reçu sur Telegram ?
 * Vérifie l'état de notification et de livraison des alertes.
 */
async function statutTelegram() {
  const lignes = ['📱 **État de livraison des notifications Telegram :**'];
  
  // Vérification de la configuration d'envoi
  const hasToken = !!process.env.TELEGRAM_BOT_TOKEN;
  const hasChat = !!process.env.TELEGRAM_CHAT_ID;
  if (!hasToken || !hasChat) {
    lignes.push(`- ⚠️ **Configuration incomplète :** ${!hasToken ? 'TELEGRAM_BOT_TOKEN manquant' : ''} ${!hasChat ? 'TELEGRAM_CHAT_ID manquant' : ''}.`);
    lignes.push(`- *Conséquence :* Les alertes sont générées dans le journal mais ne peuvent pas être transmises au bot.`);
    return { texte: lignes.join('\n') };
  }

  lignes.push(`- ✅ **Configuration :** Identifiants configurés ; activité et livraison non confirmées.`);

  // Dernier scan et décisions
  const ds = Scan.dernierScan();
  if (!ds || !ds.dernier) {
    lignes.push(`- ℹ️ Aucun scan automatique n'a encore été complété.`);
    return { texte: lignes.join('\n') };
  }

  const dernier = ds.dernier;
  if (dernier.signaux === 0) {
    lignes.push(`- ℹ️ **Aucune opportunité confirmée :** Le dernier cycle sur [${(dernier.strategies || []).join(', ')}] n'a trouvé aucun setup remplissant tous les critères.`);
    if (dernier.erreurs && dernier.erreurs.length) {
      lignes.push(`- **Motifs de refus constatés :** ${dernier.erreurs.slice(0, 3).join(' · ')}`);
    }
  } else {
    lignes.push(`- **${dernier.signaux} signal(aux) détecté(s) lors du dernier cycle.**`);
    lignes.push(`- Si tu n'as rien reçu, vérifie le mode du scan (seule la SURVEILLANCE avec statut 'confirme' envoie une alerte avec anti-doublon).`);
  }

  return { texte: lignes.join('\n') };
}

/**
 * 5. Qu'est-ce que tu as mémorisé / préférences ?
 * Relit les préférences persistées réelles en base / JSON.
 */
async function preferencesMemorisees() {
  const prefs = await Preferences.lister();
  const actifs = InstrumentsActifs.obtenirActifs();
  const lignes = ['🧠 **Mémoire et Préférences Persistées du Copilote :**'];

  lignes.push(`- **Instruments surveillés par défaut :** ${actifs.length ? actifs.map(a => typeof a === 'string' ? a : `${a.symbol} (${a.provider}, ${a.tf})`).join(', ') : 'Aucun'}`);
  if (prefs && prefs.length) {
    lignes.push(`- **Consignes et règles globales de l'instance enregistrées :**`);
    for (const p of prefs) {
      lignes.push(`  * **[${p.categorie || 'général'}]** : ${p.contenu}`);
    }
  } else {
    lignes.push(`- **Autres consignes :** Aucune préférence additionnelle personnalisée.`);
  }

  return { texte: lignes.join('\n') };
}

module.exports = {
  marchesSurveilles,
  pourquoiPasSignal,
  blocageCpi,
  statutTelegram,
  preferencesMemorisees
};
