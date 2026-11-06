#!/usr/bin/env node
/**
 * Mesure d'une stratégie autonome (logique propre, hors moteur de règles).
 *
 *   npm run strategie -- --strategie retour-moyenne --symbol R_75 --tf 5m
 *   npm run strategie -- --strategie retour-moyenne --symbol BTCUSDT --tf 5m --cout-r 0.05
 *
 * Principe : on parcourt l'historique bougie par bougie, la stratégie dit
 * « trade ou non » avec ses niveaux, puis on marche les bougies suivantes
 * jusqu'au stop, à l'objectif, ou à l'expiration. Aucune bougie future n'entre
 * dans la décision : le plan est calculé avec la bougie courante au plus.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const DB = require('../core/db');
const Candles = require('./candles');
const Performance = require('../engine/performance');

const STRATEGIES = {
  'retour-moyenne': require('../strategies/retour-moyenne')
};

function options() {
  const a = process.argv.slice(2);
  const lire = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
  const libres = a.filter(x => !x.startsWith('--'));
  const coutR = Number(lire('cout-r', '0.05'));
  const fenetre = Number(lire('fenetre', '60000'));
  return {
    nom: lire('strategie', libres[0] || 'retour-moyenne'),
    symbol: lire('symbol', libres[1] || 'R_75'),
    tf: lire('tf', libres[2] || '5m'),
    coutR: Number.isFinite(coutR) ? coutR : 0.05,
    fenetre: Number.isFinite(fenetre) ? fenetre : 60000,
    pas: Math.max(1, Number(lire('pas', '1'))),
    // Paramètres exposés : on les fait varier pour voir si l'idee tient, sans
    // toucher au code de la strategie.
    z: Number(lire('z', '0')),
    atrStop: Number(lire('atr-stop', '0')),
    efficacite: Number(lire('eff', '0'))
  };
}

/** Marche les bougies suivantes jusqu'à la sortie. Rend le R réalisé. */
function derouler(trade, bougies, depart) {
  const { sens, entree, stop, objectif } = trade;
  const risque = Math.abs(entree - stop);
  for (let i = depart; i < Math.min(bougies.length, depart + 40); i++) {
    const b = bougies[i];
    if (sens === 'BUY') {
      // Le stop est testé AVANT l'objectif : prudence, on ne suppose pas l'ordre.
      if (b.l <= stop) return { r: -1, sortie: 'stop', i };
      if (b.h >= objectif) return { r: Math.abs(objectif - entree) / risque, sortie: 'objectif', i };
    } else {
      if (b.h >= stop) return { r: -1, sortie: 'stop', i };
      if (b.l <= objectif) return { r: Math.abs(entree - objectif) / risque, sortie: 'objectif', i };
    }
  }
  const derniere = bougies[Math.min(bougies.length - 1, depart + 39)];
  const r = sens === 'BUY'
    ? (derniere.c - entree) / risque
    : (entree - derniere.c) / risque;
  return { r, sortie: 'expiration', i: Math.min(bougies.length - 1, depart + 39) };
}

async function principal() {
  const { nom, symbol, tf, coutR, fenetre, pas, z, atrStop, efficacite } = options();
  const strategie = STRATEGIES[nom];
  if (!strategie) {
    console.log(`Stratégie inconnue « ${nom} ». Disponibles : ${Object.keys(STRATEGIES).join(', ')}`);
    return;
  }

  await DB.init();
  if (!DB.isPg()) { console.log('PostgreSQL requis (npm run migrer).'); return; }

  let serie = await Candles.lire(symbol, tf, { limite: 60000 });
  if (serie.length < 500) {
    console.log(`Historique insuffisant pour ${symbol} ${tf} (${serie.length}).`);
    return;
  }
  if (serie.length > fenetre) serie = serie.slice(-fenetre);

  const trades = [];
  const refus = {};
  let i = 60;
  while (i < serie.length - 45) {
    const fen = serie.slice(0, i + 1);        // uniquement le passé
    const optionsStrategie = {};
    if (z > 0) optionsStrategie.zEntree = z;
    if (atrStop > 0) optionsStrategie.atrStop = atrStop;
    if (efficacite > 0) optionsStrategie.efficaciteMax = efficacite;
    const { trade, raison } = strategie.evaluer(fen, optionsStrategie);
    if (!trade) {
      refus[raison.split(' (')[0]] = (refus[raison.split(' (')[0]] || 0) + 1;
      i += pas;
      continue;
    }
    const sortie = derouler(trade, serie, i + 1);
    trades.push({
      r: sortie.r, at: serie[i].t, sortie: sortie.sortie,
      sens: trade.sens, z: trade.z, efficacite: trade.efficacite
    });
    // On repart APRÈS la sortie : pas de trades qui se chevauchent.
    i = Math.max(i + pas, sortie.i + 1);
  }

  if (!trades.length) {
    console.log(`\n  ${symbol} ${tf} : aucun trade. Motifs de refus :`);
    Object.entries(refus).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .forEach(([k, v]) => console.log(`    ${v.toString().padStart(6)} × ${k}`));
    return;
  }

  const coupe = Math.floor(trades.length * 0.7);
  const nets = Performance.appliquerCout(trades, coutR);
  const is = Performance.metriques(nets.slice(0, coupe));
  const oos = Performance.metriques(nets.slice(coupe));
  const brut = Performance.metriques(trades);
  const verdict = Performance.verdictDepuisMetriques(is, oos);

  console.log(`\n  ${symbol} ${tf} · ${serie.length} bougies · ${trades.length} trades · coût ${coutR} R`);
  const ligne = (nom2, m) => console.log(
    `  ${nom2.padEnd(13)} ${String(m.n).padStart(5)} trades · PF ${String(m.profitFactor).padEnd(6)} · ` +
    `espérance ${(m.expectancyR >= 0 ? '+' : '') + m.expectancyR} R · taux ${m.winRate} % · ` +
    `DD ${m.maxDrawdownR} R · total ${(m.rTotal >= 0 ? '+' : '') + m.rTotal} R`);
  ligne('entraînement', is);
  ligne('validation', oos);
  console.log(`  (brut, sans coût : espérance ${brut.expectancyR >= 0 ? '+' : ''}${brut.expectancyR} R)`);

  const sorties = {};
  trades.forEach(t => { sorties[t.sortie] = (sorties[t.sortie] || 0) + 1; });
  console.log(`  sorties : ${Object.entries(sorties).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`\n  verdict : ${verdict.fiable ? 'AVANTAGE qui tient hors échantillon' : 'NON retenu'}` +
    (verdict.raisons.length ? ` — ${verdict.raisons.join(' ; ')}` : ''));
}

module.exports = { principal, derouler, STRATEGIES };

if (require.main === module) {
  principal().then(() => process.exit(0)).catch(e => {
    console.error('ÉCHEC :', e.message);
    process.exit(1);
  });
}
