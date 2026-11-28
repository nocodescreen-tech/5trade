/**
 * 5TRADE Skill — Forex Session Monitor
 *
 * Implémentation exécutable de la surveillance des sessions de marché.
 */

const Sessions = require('../../../temporal/sessions');

const PAIRS_FOREX = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF'];
const METAUX = ['XAUUSD', 'XAGUSD'];
const SYNTHETIQUES = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', 'BOOM500', 'CRASH500'];
const CRYPTOS = ['BTCUSD', 'ETHUSD', 'SOLUSD'];

function verifier(symbol, dateOuTs = Date.now()) {
  return Sessions.statutMarche(symbol, dateOuTs);
}

function bilanGlobal(dateOuTs = Date.now()) {
  const d = dateOuTs instanceof Date ? dateOuTs : new Date(Number(dateOuTs));
  const statutForex = Sessions.statutMarche('EURUSD', d);
  const statutMetaux = Sessions.statutMarche('XAUUSD', d);
  const statutSynthetiques = Sessions.statutMarche('R_75', d);
  const statutCrypto = Sessions.statutMarche('BTCUSD', d);

  const ouverts = [];
  const fermes = [];

  if (statutForex.ouvert) ouverts.push('Forex (Devises majeures)');
  else fermes.push('Forex (Devises majeures)');

  if (statutMetaux.ouvert) ouverts.push('Métaux précieux (Or / Argent)');
  else fermes.push('Métaux précieux (Or / Argent)');

  if (statutSynthetiques.ouvert) ouverts.push('Indices Synthétiques (Deriv 24/7)');
  if (statutCrypto.ouvert) ouverts.push('Crypto-monnaies (24/7)');

  return {
    horodatage: d.toISOString(),
    forex: statutForex,
    metaux: statutMetaux,
    synthetiques: statutSynthetiques,
    crypto: statutCrypto,
    ouverts,
    fermes,
    recommandation: !statutForex.ouvert
      ? 'Le Forex est fermé selon le calendrier théorique. Respecter la sélection active.'
      : 'Le Forex est ouvert selon le calendrier théorique ; vérifier chaque instrument.'
  };
}

const wat = d => d.toLocaleString('fr-FR',{timeZone:'Africa/Kinshasa',weekday:'long',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}) + ' (Kinshasa, UTC+1)';
function messageTelegramPreCloture(dateOuTs = Date.now()) {
  const d = dateOuTs instanceof Date ? dateOuTs : new Date(Number(dateOuTs));
  const session = Sessions.statutMarche('EURUSD',d);
  if (!session.prochaineFermeture || session.statut !== 'pre_fermeture') return null;
  const fermeture = session.prochaineFermeture;
  const ouverture = Sessions.statutMarche('EURUSD',fermeture).prochaineOuverture;
  return [
    '<b>PRÉ-CLÔTURE HEBDOMADAIRE — FOREX</b>',
    'Clôture théorique : '+wat(fermeture)+' / '+fermeture.toISOString().slice(11,16)+' UTC.',
    'Réouverture théorique : '+wat(ouverture)+' / '+ouverture.toISOString().slice(11,16)+' UTC.',
    'Risque de spreads élargis, glissement et gaps. Vérifier les horaires du courtier.',
    'Indices synthétiques et cryptos : horaires distincts, généralement continus.'
  ].join('\n');
}
function messageTelegramReouverture(dateOuTs = Date.now()) {
  const d = dateOuTs instanceof Date ? dateOuTs : new Date(Number(dateOuTs));
  const session = Sessions.statutMarche('EURUSD',d);
  if (!session.ouvert || d.getUTCDay() !== 0) return null;
  const debut = new Date(d);
  debut.setUTCHours(Sessions.estHeureEteUS(d)?21:22,0,0,0);
  return [
    '<b>RÉOUVERTURE HEBDOMADAIRE — FOREX</b>',
    'Réouverture théorique : '+wat(debut)+' / '+debut.toISOString().slice(11,16)+' UTC.',
    'La reprise effective des cotations et les horaires propres au courtier restent à vérifier.',
    'Attention aux gaps et aux spreads de début de semaine.'
  ].join('\n');
}

const skill = {
  id: 'forex-session-monitor',
  nom: 'Surveillance des Sessions Forex & Marchés',
  version: '1.1.0',
  description: 'Contrôle des horaires de cotation des marchés, alertes de pré-clôture le vendredi et suivi de réouverture du dimanche.',
  actions: ['verifier_session', 'bilan_marches', 'alerte_telegram'],

  verifier,
  bilanGlobal,
  messageTelegramPreCloture,
  messageTelegramReouverture,

  async executer(params = {}, ctx = {}) {
    const action = params.action || 'bilan_marches';
    const date = params.date || Date.now();

    if (action === 'verifier_session') {
      const symbol = params.symbol || 'EURUSD';
      return verifier(symbol, date);
    }

    if (action === 'alerte_telegram') {
      const type = params.type || 'pre_cloture';
      const texte = type === 'reouverture'
        ? messageTelegramReouverture(date)
        : messageTelegramPreCloture(date);
      return { texte };
    }

    // Par défaut : bilan_marches
    return bilanGlobal(date);
  }
};

module.exports = skill;
