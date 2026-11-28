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
  lignes.push(`- **Sélection enregistrée persistante :** ${enregistres.length ? enregistres.map(x=>x.symbol+'@'+x.provider).join(', ') : 'Aucun instrument actif (scan suspendu)'}`);
  
  if (dernier) {
    lignes.push(`- **Dernier scan exécuté :** ${dernier.at} (${dernier.marches} marchés traités, durée ${dernier.dureeMs || 0} ms)`);
    lignes.push(`- **Unités de temps réelles :** [${(dernier.tfs || [dernier.tf]).join(', ')}]`);
    lignes.push(`- **Stratégies évaluées :** [${(dernier.strategies || []).join(', ') || 'Moteur générique'}]`);
    lignes.push(`- **Signaux détectés :** ${dernier.signaux}`);

    // Détection d'un écart éventuel
    if (enregistres.length > 0 && dernier.marches > 0) {
      const attendusSet = new Set(enregistres.map(s => String(s).toUpperCase()));
      if (dernier.marches > enregistres.length) {
        lignes.push(`⚠️ *Écart constaté :* Le dernier scan a évalué plus d'instruments que la sélection active stricte.`);
      } else {
        lignes.push(`Nombre de marchés compatible avec la sélection ; la seule cardinalité ne prouve pas la conformité.`);
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
  const v=await Fundamentals.filtreCalendrier('frxXAUUSD',{strict:true});
  return {texte:['Filtre macro USD / XAUUSD',v.verifie?(v.bloque?'Annonce bloquante':'Aucune annonce majeure dans la fenêtre vérifiée'):'Calendrier non vérifié : signal suspendu',v.detail||'',v.news?.titre||'',v.news?.heureKinshasa||''].filter(Boolean).join('\n')};
}

/**
 * 4. Pourquoi je n'ai rien reçu sur Telegram ?
 * Vérifie l'état de notification et de livraison des alertes.
 */
async function statutTelegram() {
  const c=require('../../delivery/alerts').get();
  if(!c.telegramToken||!c.telegramChat)return {texte:'Telegram non configuré (jeton ou chat manquant).'};
  try{
    const s=await require('../../delivery/telegram-outbox').repository(require('../../core/db').client()).status();
    return {texte:'Telegram configuré. États réellement enregistrés : '+(s.summary.map(x=>x.state+': '+x.count).join(' · ')||'aucun envoi')+'\nUn envoi en file ne garantit pas sa réception.'};
  }catch{return {texte:'Telegram configuré, mais la file persistante est indisponible. Aucune livraison ne peut être confirmée.'};}
}

/**
 * 5. Qu'est-ce que tu as mémorisé / préférences ?
 * Relit les préférences persistées réelles en base / JSON.
 */
async function preferencesMemorisees() {
  const prefs = await Preferences.lister();
  const actifs = InstrumentsActifs.obtenirActifs();
  const lignes = ['🧠 **Mémoire et Préférences Persistées du Copilote :**'];

  lignes.push(`- **Instruments surveillés par défaut :** ${actifs.length ? actifs.map(x=>x.symbol+'@'+x.provider).join(', ') : 'Aucun'}`);
  if (prefs && prefs.length) {
    lignes.push(`- **Consignes et règles permanentes enregistrées :**`);
    for (const p of prefs) {
      lignes.push(`  * **[${p.categorie || 'général'}]** : ${p.contenu||p.consigne||'indisponible'}`);
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
