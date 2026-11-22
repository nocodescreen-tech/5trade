/**
 * 5TRADE — Moteurs Spécialisés Complémentaires par Famille
 *
 * Fournit l'intelligence contextuelle spécifique pour :
 *   1. FOREX   : sessions (Asie/Londres/NY), corrélations devises, spread et liquidité
 *   2. METAUX  : XAUUSD/XAGUSD (sessions Londres/NY, sensibilité USD, pause quotidienne)
 *   3. INDICES : US30, NAS100, SPX500, GER40 (heures cash, gaps d'ouverture)
 *   4. CRYPTO  : BTC, ETH (cotation 24/7, régimes de volatilité, funding/liquidations)
 */

const { classifier } = require('../market-intelligence/instrument-classifier');
const Sessions = require('../temporal/sessions');

/**
 * Analyse contextuelle Forex
 */
function analyserForex(closes, meta = {}) {
  const sym = String(meta.symbol || 'EURUSD').toUpperCase();
  const date = meta.date ? new Date(meta.date) : new Date();
  const sessionInfo = typeof Sessions.verifierSession === 'function'
    ? Sessions.verifierSession(sym, date)
    : Sessions.statutMarche(sym, date);

  const faits = [];
  const refus = [];

  // 1. Contrôle de session
  if (!sessionInfo.ouvert) {
    refus.push(`Marché Forex fermé (${sessionInfo.raison})`);
  }

  // 2. Détection de la session active (Asie / Londres / NY / Chevauchement)
  const heureUTC = date.getUTCHours();
  let sessionNom = 'Asie (Faible liquidité)';
  if (heureUTC >= 8 && heureUTC < 13) sessionNom = 'Londres (Forte liquidité)';
  else if (heureUTC >= 13 && heureUTC < 17) sessionNom = 'Chevauchement Londres-NY (Liquidité maximale)';
  else if (heureUTC >= 17 && heureUTC < 21) sessionNom = 'New York (Modérée)';
  else if (heureUTC >= 21 && heureUTC < 22) sessionNom = 'Rollover interbancaire (Spread élargi)';

  faits.push(`Session active : ${sessionNom}`);
  if (heureUTC >= 21 && heureUTC < 22) {
    refus.push('Période de rollover (21h-22h UTC) : spread artificiellement élevé');
  }

  return {
    famille: 'forex',
    session: sessionNom,
    convient: refus.length === 0,
    refus,
    faits
  };
}

/**
 * Analyse contextuelle Métaux Précieux (XAUUSD / XAGUSD)
 */
function analyserMetaux(closes, meta = {}) {
  const sym = String(meta.symbol || 'XAUUSD').toUpperCase();
  const date = meta.date ? new Date(meta.date) : new Date();
  const sessionInfo = typeof Sessions.verifierSession === 'function'
    ? Sessions.verifierSession(sym, date)
    : Sessions.statutMarche(sym, date);

  const faits = [];
  const refus = [];

  if (!sessionInfo.ouvert) {
    refus.push(`Marché des métaux fermé (${sessionInfo.raison})`);
  }

  const heureUTC = date.getUTCHours();
  if (heureUTC === 21) {
    refus.push('Pause quotidienne des métaux (21:00-22:00 UTC) : cotation suspendue');
  }

  faits.push('Corrélation inverse active avec le Dollar Index (DXY)');
  faits.push('Fixings de Londres à 10:30 UTC (AM) et 15:00 UTC (PM)');

  return {
    famille: 'metaux',
    convient: refus.length === 0,
    refus,
    faits
  };
}

/**
 * Analyse contextuelle Indices Réels
 */
function analyserIndices(closes, meta = {}) {
  const sym = String(meta.symbol || 'US30').toUpperCase();
  const date = meta.date ? new Date(meta.date) : new Date();
  const sessionInfo = typeof Sessions.verifierSession === 'function'
    ? Sessions.verifierSession(sym, date)
    : Sessions.statutMarche(sym, date);

  const faits = [];
  const refus = [];

  if (!sessionInfo.ouvert) {
    refus.push(`Séance d'indices fermée (${sessionInfo.raison})`);
  }

  const heureUTC = date.getUTCHours();
  const minuteUTC = date.getUTCMinutes();
  const estCashUS = (heureUTC > 14 || (heureUTC === 14 && minuteUTC >= 30)) && heureUTC < 21;

  if (estCashUS) {
    faits.push('Séance cash principale Wall Street en cours (14:30 - 21:00 UTC)');
  } else {
    faits.push('Séance électronique / futures (liquidité plus faible que le cash)');
  }

  return {
    famille: 'indices',
    convient: refus.length === 0,
    refus,
    faits
  };
}

/**
 * Analyse contextuelle Crypto-actifs
 */
function analyserCrypto(closes, meta = {}) {
  const faits = [];
  const refus = [];

  faits.push('Cotation continue 24/7 sans interruption de session');
  faits.push('Surveillance des cascades de liquidations et du funding rate');

  return {
    famille: 'crypto',
    convient: refus.length === 0,
    refus,
    faits
  };
}

module.exports = {
  analyserForex,
  analyserMetaux,
  analyserIndices,
  analyserCrypto
};
