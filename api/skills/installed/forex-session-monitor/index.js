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
      ? 'Les marchés conventionnels (Forex/Métaux) sont fermés. Privilégiez les indices synthétiques Deriv ou les cryptos pour vos analyses du week-end.'
      : 'Tous les marchés majeurs sont actuellement ouverts aux cotations.'
  };
}

function messageTelegramPreCloture(dateOuTs = Date.now()) {
  const d = dateOuTs instanceof Date ? dateOuTs : new Date(Number(dateOuTs));
  return [
    '🔔 <b>AVERTISSEMENT DE CLÔTURE HEBDOMADAIRE — FOREX</b>',
    '',
    `🕒 Heure actuelle : ${d.toISOString().slice(11, 16)} UTC`,
    '⚠️ Les marchés Forex et Métaux fermeront ce soir à <b>22:00 UTC</b>.',
    '',
    '• Risques accrus de <b>slippage</b> et d\'élargissement des <b>spreads</b> interbancaires.',
    '• Recommandation : clôturer ou sécuriser au breakeven vos positions swing/intraday pour éviter les gaps de week-end.',
    '• Réouverture : dimanche à 22:00 UTC.',
    '',
    '<i>Les indices synthétiques Deriv et les cryptos restent ouverts 24/7.</i>'
  ].join('\n');
}

function messageTelegramReouverture(dateOuTs = Date.now()) {
  return [
    '🌅 <b>RÉOUVERTURE DES MARCHÉS FOREX & MÉTAUX</b>',
    '',
    '✅ Les cotations interbancaires ont repris (dimanche 22:00 UTC).',
    '🔍 Surveillez les éventuels gaps de prix et la normalisation des spreads de session asiatique.',
    '🚀 Prêt pour une nouvelle semaine de trading avec 5TRADE !'
  ].join('\n');
}

const skill = {
  id: 'forex-session-monitor',
  nom: 'Surveillance des Sessions Forex & Marchés',
  version: '1.0.0',
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
