/**
 * PEUT-ON SE PASSER DES ACTIONS ?
 *
 * Les 8 indices ne valaient que 2,7 paris indépendants et portaient le doute
 * « c'est du bêta ». Or, argent, cuivre, coton et café sont corrélés 0,09 à 0,34
 * aux actions et gagnent avec le filtre de tendance.
 *
 * Question : un portefeuille SANS aucune action tient-il ? Si oui, l'avantage
 * n'a plus besoin du marché actions pour exister.
 *
 * Usage : node tools/portefeuille-sans-actions.js
 */
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');
const R = require('../api/risque');
const V = require('../api/validite');

const MARCHES = {
  'GC=F': { spread: 0.30, nom: 'Or' },
  'SI=F': { spread: 0.005, nom: 'Argent' },
  'HG=F': { spread: 0.0005, nom: 'Cuivre' },
  'CT=F': { spread: 0.01, nom: 'Coton' },
  'KC=F': { spread: 0.05, nom: 'Café' }
};
const profils = [{ id: 'p', titre: 'T', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {} }];

const tous = [], parMarche = [];
for (const [sym, cfg] of Object.entries(MARCHES)) {
  const b = H.charger('yahoo', sym, '1d');
  if (!b || b.length < 400) continue;
  F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15,
    parSymbole: { [sym]: { spread: cfg.spread, glissement: cfg.spread } } });
  const r = B.lancer(b, { symbol: sym, timeframe: '1d' },
    { profils, pas: 1, maxBougies: b.length, plafond: 20000, limiteTrades: 1e6,
      modele: false, sources: ['motif', 'structure'], regime: true });
  const tr = (r.trades || []).filter(t => Number.isFinite(t.r) && Number.isFinite(t.at));
  if (!tr.length) continue;
  const rs = tr.map(t => t.r);
  parMarche.push({ sym, nom: cfg.nom, n: tr.length, e: rs.reduce((a, x) => a + x, 0) / rs.length });
  for (const t of tr) tous.push({ at: t.at, symbol: sym, entree: t.entree, stop: t.stop,
    resultat: t.resultat, r: t.r, leveLe: t.leveLe });
}
F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15, parSymbole: {} });
tous.sort((a, b) => a.at - b.at);

const annees = (tous.at(-1).at - tous[0].at) / (365.25 * 86400000);
const e = tous.reduce((a, t) => a + t.r, 0) / tous.length;
console.log(`\n  SANS AUCUNE ACTION — ${parMarche.length} matières premières, ${annees.toFixed(1)} ans\n`);
for (const m of parMarche.sort((a, b) => b.e - a.e)) {
  console.log(`  ${m.nom.padEnd(9)} ${String(m.n).padStart(5)} trades · ${(m.e * 100).toFixed(2).padStart(6)} % du risque`);
}
console.log(`\n  ${tous.length} trades · ${(e * 100).toFixed(2)} % du risque par trade · `
  + `${parMarche.filter(m => m.e > 0).length}/${parMarche.length} positifs`);

// Par année : le portefeuille survit-il aux années difficiles ?
const parAn = new Map();
for (const t of tous) {
  const a = new Date(t.at).getUTCFullYear();
  const x = parAn.get(a) || { n: 0, r: 0 };
  parAn.set(a, { n: x.n + 1, r: x.r + t.r });
}
console.log('\n  année   trades   total R');
for (const [a, v] of [...parAn.entries()].sort()) {
  console.log(`  ${a}   ${String(v.n).padStart(6)}   ${v.r.toFixed(0).padStart(7)}`);
}
const perdantes = [...parAn.values()].filter(v => v.r < 0).length;
console.log(`  → ${perdantes} année(s) perdante(s) sur ${parAn.size}`);

console.log('\n  risque/trade  positions   pris    rendement/an   drawdown   ratio');
console.log('  ' + '─'.repeat(70));
let meilleur = null;
for (const pct of [0.25, 0.5, 1, 2]) {
  for (const pos of [5, 10]) {
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
