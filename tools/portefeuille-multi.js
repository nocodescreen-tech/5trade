/**
 * PORTEFEUILLE MULTI-MARCHÉS — la diversification qui manquait.
 *
 * Les indices d'actions ne valaient que 2,7 paris indépendants. Le filtre de
 * tendance a révélé des marchés qui tendent SANS suivre les actions :
 *   or +23,5 % · argent +18,8 % · coton +18,3 % · café +13,2 % · cuivre +6,6 %
 * (corrélations 0,09 à 0,34 avec le panier d'indices.)
 *
 * On les agrège aux indices et on compose le capital sous les plafonds réels.
 * C'est le premier portefeuille du projet où les paris ne sont pas tous le même.
 *
 * Usage : node tools/portefeuille-multi.js [risquePct] [positions]
 */
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');
const R = require('../api/risque');
const V = require('../api/validite');

const MARCHES = {
  // Actions (2,7 paris effectifs)
  'NQ=F': 1, 'YM=F': 1, 'ES=F': 0.25, 'RTY=F': 0.1,
  '^GDAXI': 2, '^FTSE': 1, '^N225': 5, '^HSI': 5,
  // Matières premières décorrélées
  'GC=F': 0.30, 'SI=F': 0.005, 'CT=F': 0.01, 'KC=F': 0.05, 'HG=F': 0.0005
};
const profils = [{ id: 'p', titre: 'T', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {} }];

const tous = [], parMarche = [];
for (const [sym, spread] of Object.entries(MARCHES)) {
  const b = H.charger('yahoo', sym, '1d');
  if (!b || b.length < 300) continue;
  F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15,
    parSymbole: { [sym]: { spread, glissement: spread } } });
  const r = B.lancer(b, { symbol: sym, timeframe: '1d' },
    { profils, pas: 1, maxBougies: b.length, plafond: 20000, limiteTrades: 1e6,
      modele: false, sources: ['motif', 'structure'], regime: true });
  const tr = (r.trades || []).filter(t => Number.isFinite(t.r) && Number.isFinite(t.at));
  if (tr.length < 80) continue;
  const rs = tr.map(t => t.r);
  parMarche.push({ sym, n: tr.length, e: rs.reduce((a, x) => a + x, 0) / rs.length, sharpe: V.sharpe(rs) });
  for (const t of tr) tous.push({ at: t.at, symbol: sym, entree: t.entree, stop: t.stop,
    resultat: t.resultat, r: t.r, leveLe: t.leveLe });
}
F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15, parSymbole: {} });
tous.sort((a, b) => a.at - b.at);

const annees = (tous.at(-1).at - tous[0].at) / (365.25 * 86400000);
const pooled = tous.map(t => t.r);
const e = pooled.reduce((a, x) => a + x, 0) / pooled.length;
const variance = V.moments(parMarche.map(m => m.sharpe)).ecart ** 2 || 4e-4;

console.log(`\n  ${parMarche.length} marchés · ${tous.length} trades · ${annees.toFixed(1)} ans`);
console.log('  ' + '─'.repeat(52));
for (const m of parMarche.sort((a, b) => b.e - a.e)) {
  console.log(`  ${m.sym.padEnd(9)} ${String(m.n).padStart(5)} trades · `
    + `${(m.e * 100).toFixed(2).padStart(6)} % du risque`);
}
console.log(`\n  espérance agrégée : ${(e * 100).toFixed(2)} % du risque par trade`);
console.log(`  marchés positifs  : ${parMarche.filter(m => m.e > 0).length}/${parMarche.length}`);
console.log(`  DSR (déflaté ${parMarche.length}) : ${V.dsr(pooled, parMarche.length, variance).psr.toFixed(3)}`);

// Composition du capital sous les plafonds.
const pctDemande = Number(process.argv[2]) || null;
const posDemandees = Number(process.argv[3]) || null;
console.log('\n  risque/trade  positions   pris    rendement/an   drawdown   ratio');
console.log('  ' + '─'.repeat(70));
let meilleur = null;
const pcts = pctDemande ? [pctDemande] : [0.25, 0.5, 1];
const positions = posDemandees ? [posDemandees] : [5, 10, 15];
for (const pct of pcts) {
  for (const pos of positions) {
    R.configurer({ risquePct: pct, maxSimultanes: pos, maxRisqueMarchePct: 2, maxRisqueTotalPct: 5 });
    const s = R.simuler(tous, { capital: 1000, risquePct: pct });
    const cagr = (Math.pow(s.capital / 1000, 1 / annees) - 1) * 100;
    const dd = Math.abs(s.drawdownPct);
    const ratio = dd > 0 ? cagr / dd : Infinity;
    console.log(`  ${String(pct).padStart(8)} %  ${String(pos).padStart(9)}   ${String(s.prises).padStart(5)}   `
      + `${cagr.toFixed(1).padStart(9)} %   ${dd.toFixed(1).padStart(6)} %   ${ratio.toFixed(2).padStart(5)}`);
    if (!meilleur || ratio > meilleur.ratio) meilleur = { pct, pos, cagr, dd, ratio, prises: s.prises };
  }
}
R.configurer({ risquePct: 1, maxSimultanes: 5, maxRisqueMarchePct: 2, maxRisqueTotalPct: 5 });
console.log(`\n  MEILLEUR : ${meilleur.pct} % · ${meilleur.pos} positions → `
  + `${meilleur.cagr.toFixed(1)} %/an pour ${meilleur.dd.toFixed(1)} % de drawdown `
  + `(ratio ${meilleur.ratio.toFixed(2)}, ${meilleur.prises} prises)`);
