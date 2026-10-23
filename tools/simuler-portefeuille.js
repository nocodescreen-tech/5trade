/**
 * LE VRAI CHIFFRE : le portefeuille d'indices simulé sous les plafonds du compte.
 *
 * 23 346 trades sur 10 ans ne tiennent pas dans 5 positions simultanées. Tant
 * qu'on ne simule pas cette contrainte, « +1 064 R » est une somme de trades
 * indépendants qui n'ont jamais coexisté. Ici on compose réellement le capital,
 * trade par trade, avec les plafonds du module de risque.
 *
 * Usage : node tools/simuler-portefeuille.js [capital] [risquePct]
 */
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');
const R = require('../api/risque');

const capital0 = Number(process.argv[2]) || 1000;
const risquePct = Number(process.argv[3]) || 1;

const INDICES = {
  'NQ=F': 1.00, 'YM=F': 1.00, 'ES=F': 0.25, 'RTY=F': 0.10,
  '^GDAXI': 2.0, '^FTSE': 1.0, '^N225': 5.0, '^HSI': 5.0
};
const profil = [{ id: 'p', titre: 'T', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {} }];

const tous = [];
for (const [sym, spread] of Object.entries(INDICES)) {
  const bougies = H.charger('yahoo', sym, '1d');
  if (!bougies || bougies.length < 300) continue;
  F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0,
    partMax: 0.15, parSymbole: { [sym]: { spread, glissement: spread } } });
  const r = B.lancer(bougies, { symbol: sym, timeframe: '1d' },
    { profils: profil, pas: 1, maxBougies: bougies.length, plafond: 20000,
      limiteTrades: 1e6, modele: false });
  for (const t of (r.trades || [])) {
    if (!Number.isFinite(t.r) || !Number.isFinite(t.at)) continue;
    tous.push({ at: t.at, symbol: sym, entree: t.entree, stop: t.stop,
      resultat: t.resultat, r: t.r, leveLe: t.leveLe });
  }
}
F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15, parSymbole: {} });

tous.sort((a, b) => a.at - b.at);
const mois = (tous.at(-1).at - tous[0].at) / (30.44 * 86400000);

const sim = R.simuler(tous, { capital: capital0, risquePct });

const annees = mois / 12;
const cagr = (Math.pow(sim.capital / capital0, 1 / annees) - 1) * 100;

console.log(`\nPORTEFEUILLE 8 INDICES · quotidien · ${annees.toFixed(1)} ans`);
console.log(`  trades générés      : ${tous.length}`);
console.log(`  trades PRIS         : ${sim.prises} (${sim.tauxPrise} %)`);
console.log(`  refusés par plafond : ${sim.refusees}`);
console.log(`  capital             : ${capital0} → ${sim.capital} (${sim.gainPct >= 0 ? '+' : ''}${sim.gainPct} %)`);
console.log(`  rendement annuel    : ${cagr.toFixed(1)} %`);
console.log(`  drawdown max        : ${sim.drawdownPct} %`);
console.log(`  composition naïve   : ${sim.naif ? sim.naif.gainPct + ' %' : '—'} (sans plafonds, pour comparaison)`);
console.log('  principaux refus :');
for (const [k, n] of Object.entries(sim.raisonsRefus || {}).sort((a, b) => b[1] - a[1]).slice(0, 4)) {
  console.log(`     ${String(n).padStart(6)} × ${String(k).slice(0, 60)}`);
}
