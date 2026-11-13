/**
 * 5trade — Apprentissage : rejeu journalier.
 *
 * Chaque nuit à 02:00 UTC, rejoue la journée écoulée avec les seuils actuels
 * ET avec des variantes candidates. Compare les outcomes, publie les
 * ajustements proposés.
 *
 * Ne prend aucun trade réel : travaille sur les données historiques.
 */

const fs = require('fs').promises;
const path = require('path');
const ATR = require('../atr-unifie');
const Memoire = require('../memoire');
const PostMortem = require('../post-mortem/generateur');

const JOURNAL_DIR = () => path.join(process.env.DATA_DIR || './data', 'apprentissage');

/**
 * Rejoue une journée pour un instrument.
 *
 * @param {object} p
 * @param {string} p.instrument
 * @param {Date}   p.jour        jour à rejouer (00:00 UTC à 23:59 UTC)
 * @param {object} p.seuils      paramètres à utiliser (loueur depuis diff-versionne)
 * @param {object} p.market      source de données (Market.getCandles)
 * @returns {Promise<{trades:Array, expectancy:number, winRate:number}>}
 */
async function rejouerJournee({ instrument, jour, seuils, market }) {
  const debut = new Date(jour); debut.setUTCHours(0, 0, 0, 0);
  const fin = new Date(jour); fin.setUTCHours(23, 59, 59, 999);

  // Charge les bougies H1 et M5 pour la journée
  const candlesH1 = await market.getCandles(instrument, '1h', 200, undefined, debut, fin);
  const candlesM5 = await market.getCandles(instrument, '5m', 500, undefined, debut, fin);

  if (!candlesH1 || candlesH1.length < 20) {
    return { trades: [], expectancy: 0, winRate: 0, raison: 'pas assez de bougies H1' };
  }

  // Simulation simplifiée : pour chaque bougie H1 close, on génère un
  // scénario hypothétique et on regarde si M5 confirme dans les 2h suivantes.
  // En production, ce serait un appel au générateur de scénarios complet.
  const trades = [];
  for (let i = 20; i < candlesH1.length; i++) {
    const candle = candlesH1[i];
    const carte = calculerCarteSimple(candlesH1.slice(0, i + 1));
    const atr14 = ATR.atr(candlesH1.slice(0, i + 1), 14);
    if (!carte || !atr14) continue;

    // Test : prix touche POC, M5 a une pin bar, RSI < 35
    const poc = carte.niveaux.find(n => n.type === 'support');
    if (!poc) continue;

    const cinqHeuresProchaines = candlesM5.filter(c =>
      c.t >= candle.t && c.t <= candle.t + 2 * 3600 * 1000);

    for (const m5 of cinqHeuresProchaines) {
      const toucher = Math.abs(m5.l - poc.prix) < atr14 * 0.1;
      if (!toucher) continue;
      const rsi = rsiSimple(cinqHeuresProchaines.slice(0, cinqHeuresProchaines.indexOf(m5) + 1), 14);
      const pinBar = estPinBar(m5);
      if (rsi < (seuils.rsi_m5_entree || 35) && pinBar) {
        // Simule le trade
        const stop = poc.prix - atr14 * (seuils.stop_atr || 1.0);
        const tp1 = poc.prix + atr14 * (seuils.tp1_atr || 1.27);
        const tp2 = poc.prix + atr14 * (seuils.tp2_atr || 2.0);
        // Cherche l'issue dans les bougies suivantes
        const suite = cinqHeuresProchaines.slice(cinqHeuresProchaines.indexOf(m5) + 1);
        const issue = chercherIssue(suite, poc.prix, stop, tp1, tp2, 'long');
        trades.push({
          instrument,
          entree_at: new Date(m5.t).toISOString(),
          entree_prix: poc.prix,
          stop_prix: stop,
          tp1_prix: tp1,
          tp2_prix: tp2,
          direction: 'long',
          ...issue,
          regime_entree: carte.regime,
          killzone_entree: killzonePour(new Date(m5.t))
        });
        break;  // un seul trade par scénario
      }
    }
  }

  // Calcule expectancy et winRate
  const expectancy = trades.length
    ? trades.reduce((a, t) => a + (Number(t.r_realise) || 0), 0) / trades.length
    : 0;
  const gagnants = trades.filter(t => (Number(t.r_realise) || 0) > 0).length;
  const winRate = trades.length ? gagnants / trades.length : 0;

  return { trades, expectancy, winRate };
}

function calculerCarteSimple(candles) {
  if (candles.length < 20) return null;
  const derniers = candles.slice(-50);
  const highs = derniers.map(c => c.h);
  const lows = derniers.map(c => c.l);
  const pocPrix = derniereProc(derniers);
  const regime = detecterRegimeSimple(derniers);
  return {
    niveaux: [{ type: 'support', prix: pocPrix }],
    regime,
  };
}

function derniereProc(candles) {
  // Approximation : mediane des lows
  const lows = candles.map(c => c.l).sort((a, b) => a - b);
  return lows[Math.floor(lows.length / 2)];
}

function detecterRegimeSimple(candles) {
  const closes = candles.map(c => c.c);
  const debut = closes[0], fin = closes[closes.length - 1];
  const variation = (fin - debut) / debut;
  if (variation > 0.005) return 'trend_haussier';
  if (variation < -0.005) return 'trend_baissier';
  return 'range';
}

function rsiSimple(candles, period = 14) {
  if (candles.length < period + 1) return 50;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = candles[i].c - candles[i - 1].c;
    if (ch > 0) avgGain += ch; else avgLoss += Math.abs(ch);
  }
  avgGain /= period; avgLoss /= period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function estPinBar(c) {
  const corps = Math.abs(c.c - c.o);
  const mècheBasse = Math.min(c.o, c.c) - c.l;
  const mècheHaute = c.h - Math.max(c.o, c.c);
  const total = c.h - c.l;
  if (total === 0) return false;
  return mècheBasse / total > 0.6 && corps / total < 0.35;
}

function chercherIssue(suite, entree, stop, tp1, tp2, direction) {
  for (const c of suite) {
    if (direction === 'long') {
      if (c.l <= stop) return { issue: 'stop', r_realise: -1, duree_minutes: Math.round((c.t - suite[0].t) / 60000) };
      if (c.h >= tp1) {
        // TP1 atteint, on simule TP2
        const suite2 = suite.slice(suite.indexOf(c) + 1);
        for (const c2 of suite2) {
          if (c2.l <= entree) return { issue: 'breakeven', r_realise: 0, duree_minutes: Math.round((c2.t - suite[0].t) / 60000) };
          if (c2.h >= tp2) return { issue: 'tp2', r_realise: 2, duree_minutes: Math.round((c2.t - suite[0].t) / 60000) };
        }
        return { issue: 'tp1', r_realise: 1.27, duree_minutes: Math.round((suite[suite.length - 1].t - suite[0].t) / 60000) };
      }
    } else {
      // Symétrique pour short
      if (c.h >= stop) return { issue: 'stop', r_realise: -1, duree_minutes: Math.round((c.t - suite[0].t) / 60000) };
      if (c.l <= tp1) {
        const suite2 = suite.slice(suite.indexOf(c) + 1);
        for (const c2 of suite2) {
          if (c2.h >= entree) return { issue: 'breakeven', r_realise: 0, duree_minutes: Math.round((c2.t - suite[0].t) / 60000) };
          if (c2.l <= tp2) return { issue: 'tp2', r_realise: 2, duree_minutes: Math.round((c2.t - suite[0].t) / 60000) };
        }
        return { issue: 'tp1', r_realise: 1.27, duree_minutes: Math.round((suite[suite.length - 1].t - suite[0].t) / 60000) };
      }
    }
  }
  return { issue: 'timeout', r_realise: 0, duree_minutes: 180 };
}

function killzonePour(date) {
  const hUtc = date.getUTCHours();
  if (hUtc >= 8 && hUtc < 11) return 'london';
  if (hUtc >= 13 && hUtc < 16) return 'ny';
  if (hUtc >= 23 || hUtc < 2) return 'asia';
  return 'hors_session';
}

module.exports = { rejouerJournee };
