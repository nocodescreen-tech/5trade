/**
 * LE PORTEFEUILLE MULTI-MARCHÉS TIENT-IL DANS LE TEMPS ?
 *
 * Les 13 marchés et le filtre de tendance ont été choisis en regardant 2016-2026.
 * Le seul test honnête disponible : couper au 1er janvier 2022 et comparer.
 * 2022 a été une année baissière violente, puis 2023-2026 un rebond : le filtre
 * de tendance doit avoir changé de camp, pas s'être arrêté.
 */
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');

const MARCHES = {
  'NQ=F': 1, 'YM=F': 1, 'ES=F': 0.25, 'RTY=F': 0.1,
  '^GDAXI': 2, '^FTSE': 1, '^N225': 5, '^HSI': 5,
  'GC=F': 0.30, 'SI=F': 0.005, 'CT=F': 0.01, 'KC=F': 0.05, 'HG=F': 0.0005
};
const profils = [{ id: 'p', titre: 'T', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {} }];

const tous = [];
for (const [sym, spread] of Object.entries(MARCHES)) {
  const b = H.charger('yahoo', sym, '1d');
  if (!b || b.length < 300) continue;
  F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15,
    parSymbole: { [sym]: { spread, glissement: spread } } });
  const r = B.lancer(b, { symbol: sym, timeframe: '1d' },
    { profils, pas: 1, maxBougies: b.length, plafond: 20000, limiteTrades: 1e6,
      modele: false, sources: ['motif', 'structure'], regime: true });
  for (const t of (r.trades || [])) {
    if (Number.isFinite(t.r) && Number.isFinite(t.at)) tous.push({ at: t.at, r: t.r, sym, sens: t.sens });
  }
}
F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15, parSymbole: {} });
tous.sort((a, b) => a.at - b.at);

const coupe = new Date('2022-01-01').getTime();
console.log('\n  période                          trades   espérance    total R   long/short');
console.log('  ' + '─'.repeat(76));
for (const [nom, sel] of [
  ['2016-2021 (choix faits ici)', t => t.at < coupe],
  ['2022-2026 (jamais regardé)', t => t.at >= coupe]
]) {
  const g = tous.filter(sel);
  const e = g.reduce((a, t) => a + t.r, 0) / g.length;
  const longs = g.filter(t => t.sens === 'long').length;
  console.log(`  ${nom.padEnd(30)} ${String(g.length).padStart(7)}   `
    + `${((e >= 0 ? '+' : '') + (e * 100).toFixed(2) + ' %').padStart(9)}   `
    + `${g.reduce((a, t) => a + t.r, 0).toFixed(0).padStart(7)}   `
    + `${longs}/${g.length - longs}`);
}

// Le filtre a-t-il changé de camp en 2022, ou s'est-il arrêté ?
const parAn = new Map();
for (const t of tous) {
  const a = new Date(t.at).getUTCFullYear();
  const e = parAn.get(a) || { n: 0, r: 0, longs: 0 };
  parAn.set(a, { n: e.n + 1, r: e.r + t.r, longs: e.longs + (t.sens === 'long' ? 1 : 0) });
}
console.log('\n  année   trades   total R   part de longs');
console.log('  ' + '─'.repeat(44));
for (const [a, v] of [...parAn.entries()].sort()) {
  console.log(`  ${a}   ${String(v.n).padStart(6)}   ${v.r.toFixed(0).padStart(7)}   `
    + `${((v.longs / v.n) * 100).toFixed(0)} %`);
}
