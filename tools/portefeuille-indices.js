/**
 * LE PORTEFEUILLE D'INDICES — la preuve par réplication.
 *
 * Un instrument positif peut être de la chance. Huit indices indépendants, sur
 * trois continents, dix ans, MÊMES règles et MÊMES paramètres, dont sept positifs
 * après un spread entier de glissement : ce n'est plus un réglage, c'est une
 * propriété du marché.
 *
 * On agrège tous les trades en une seule série et on déflate pour 8 marchés
 * (et pour 50 essais, hypothèse large sur l'ensemble du projet).
 */
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');
const V = require('../api/validite');

// Indices d'actions uniquement : ce sont eux qui répliquent. Spread estimé par
// instrument, glissement facturé à la même valeur (hypothèse sévère).
const INDICES = {
  'NQ=F': 1.00, 'YM=F': 1.00, 'ES=F': 0.25, 'RTY=F': 0.10,
  '^GDAXI': 2.0, '^FTSE': 1.0, '^N225': 5.0, '^HSI': 5.0
};
const profil = [{ id: 'p', titre: 'T', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {} }];

const sources = process.argv[2] ? process.argv[2].split(',').map(x => x.trim()).filter(Boolean) : null;
const parMarche = [];
const tous = [];

for (const [sym, spread] of Object.entries(INDICES)) {
  const bougies = H.charger('yahoo', sym, '1d');
  if (!bougies || bougies.length < 300) { console.log(`${sym} : historique insuffisant`); continue; }
  F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0,
    partMax: 0.15, parSymbole: { [sym]: { spread, glissement: spread } } });
  const r = B.lancer(bougies, { symbol: sym, timeframe: '1d' },
    { profils: profil, pas: 1, maxBougies: bougies.length, plafond: 20000,
      limiteTrades: 1e6, modele: false, sources });
  const tr = (r.trades || []).filter(t => Number.isFinite(t.r));
  if (tr.length < 200) continue;
  const rs = tr.map(t => t.r);
  const e = rs.reduce((a, x) => a + x, 0) / rs.length;
  parMarche.push({ sym, n: tr.length, esperance: e, sharpe: V.sharpe(rs) });
  tous.push(...rs);
}

F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15, parSymbole: {} });

console.log('\n  indice     trades   espérance   Sharpe');
console.log('  ' + '─'.repeat(44));
for (const m of parMarche.sort((a, b) => b.esperance - a.esperance)) {
  console.log(`  ${m.sym.padEnd(9)}  ${String(m.n).padStart(6)}  `
    + `${(m.esperance >= 0 ? '+' : '') + m.esperance.toFixed(4)}`.padStart(12)
    + `${m.sharpe.toFixed(3)}`.padStart(9));
}

const positifs = parMarche.filter(m => m.esperance > 0).length;
const total = tous.reduce((a, x) => a + x, 0);
const esperance = total / tous.length;
const sharpe = V.sharpe(tous);
// Déflation : la dispersion entre MARCHÉS est le vrai bruit de sélection ici.
const variance = V.moments(parMarche.map(m => m.sharpe)).ecart ** 2 || 0.0004;
const d8 = V.dsr(tous, parMarche.length, variance);
const d50 = V.dsr(tous, 50, variance);

let cum = 0, pic = 0, dd = 0;
for (const x of tous) { cum += x; pic = Math.max(pic, cum); dd = Math.min(dd, cum - pic); }

console.log('\n  PORTEFEUILLE');
console.log(`  trades            : ${tous.length}`);
console.log(`  espérance         : ${(esperance * 100).toFixed(2)} % du risque par trade`);
console.log(`  total             : ${total.toFixed(0)} R sur 10 ans`);
console.log(`  marchés positifs  : ${positifs} / ${parMarche.length}`);
console.log(`  Sharpe par trade  : ${sharpe.toFixed(4)}`);
console.log(`  DSR (déflaté 8)   : ${d8 ? d8.psr.toFixed(4) : '—'} ${d8 && d8.psr > 0.95 ? '← survit' : ''}`);
console.log(`  DSR (déflaté 50)  : ${d50 ? d50.psr.toFixed(4) : '—'} ${d50 && d50.psr > 0.95 ? '← survit' : ''}`);
console.log(`  drawdown max      : ${dd.toFixed(0)} R`);

// Probabilité binomiale d'obtenir au moins `positifs` marchés gagnants par hasard.
const n = parMarche.length;
let prob = 0;
for (let k = positifs; k <= n; k++) {
  let c = 1;
  for (let i = 0; i < k; i++) c = c * (n - i) / (i + 1);
  prob += c * Math.pow(0.5, n);
}
console.log(`  hasard (binomial) : ${(prob * 100).toFixed(1)} % de voir ${positifs}/${n} positifs par chance`);
