/**
 * BALAYAGE HORIZONS × INSTRUMENTS — où l'espérance survit-elle à la friction ?
 *
 * Le coût en R vaut spread / distance au stop. Un stop quotidien est 10 à 30 fois
 * plus large qu'un stop horaire : le même spread y pèse 10 à 30 fois moins. C'est
 * le levier le plus direct sur la rentabilité, et il ne coûte rien à tester.
 *
 * Usage : node tools/sweep-horizons.js 1d            (tous les instruments)
 *         node tools/sweep-horizons.js 1h BTC-USD    (un instrument)
 */
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');

const tf = process.argv[2] || '1d';
const cible = process.argv[3] || null;

const INSTRUMENTS = {
  'GC=F': 0.30,        // or COMEX, 30 cents
  'BTC-USD': 12,       // bitcoin, ~12 $
  'EURUSD=X': 0.00012, // 1,2 pip
  'ES=F': 0.25,        // S&P 500 futures, 1 tick = 0,25
  'NQ=F': 1.00,        // Nasdaq futures, 1 tick = 0,25 × 4
  'CL=F': 0.02,        // WTI, 2 cents
  'YM=F': 1.00,        // Dow futures, 1 tick
  'RTY=F': 0.10,       // Russell, 1 tick
  '^GDAXI': 2.0,       // DAX (indice, spread estimé)
  '^FTSE': 1.0,        // FTSE 100
  '^N225': 5.0,        // Nikkei
  '^HSI': 5.0          // Hang Seng
};
const PAS = { '1d': 1, '4h': 2, '1h': 4 }[tf] || 2;

const profil = [{ id: 'p', titre: 'T', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {} }];
const cle = t => String(t.concept || t.strategie || t.nom || '?').replace(/\s+[\d.,]+.*$/, '').trim();

function mesurer(sym, spread, glissement) {
  const bougies = H.charger('yahoo', sym, tf);
  if (!bougies || bougies.length < 300) return null;
  F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0,
    partMax: 0.15, parSymbole: { [sym]: { spread, glissement } } });
  const r = B.lancer(bougies, { symbol: sym, timeframe: tf },
    { profils: profil, pas: PAS, maxBougies: bougies.length, plafond: 20000,
      limiteTrades: 1e6, modele: false });
  const tr = (r.trades || []).filter(t => Number.isFinite(t.r));

  const fam = new Map();
  for (const t of tr) {
    const k = cle(t);
    if (!fam.has(k)) fam.set(k, []);
    fam.get(k).push(t.r);
  }
  const top = [...fam.entries()]
    .filter(([, rs]) => rs.length >= 25)
    .map(([k, rs]) => ({ k, n: rs.length, e: rs.reduce((a, x) => a + x, 0) / rs.length }))
    .sort((a, b) => b.e - a.e);

  return {
    n: tr.length,
    total: tr.reduce((a, t) => a + t.r, 0),
    esperance: tr.length ? tr.reduce((a, t) => a + t.r, 0) / tr.length : null,
    top
  };
}

const liste = (cible ? [cible] : Object.keys(INSTRUMENTS)).filter(s => INSTRUMENTS[s] !== undefined);

console.log(`Horizon ${tf} · pas ${PAS} · ${liste.length} instrument(s) · glissement = 1 spread\n`);
console.log('  instrument    bougies  trades   esp.0gliss   esp.1gliss   meilleure famille');
console.log('  ' + '─'.repeat(78));

for (const sym of liste) {
  const spread = INSTRUMENTS[sym];
  const a = mesurer(sym, spread, 0);
  const b = mesurer(sym, spread, spread);
  if (!a || !b) { console.log(`  ${sym.padEnd(12)}  historique insuffisant`); continue; }
  const bougies = H.charger('yahoo', sym, tf).length;
  const fmt = v => (v === null ? '     —' : (v >= 0 ? '+' : '') + v.toFixed(4)).padStart(12);
  const meilleure = b.top[0];
  console.log(`  ${sym.padEnd(12)}  ${String(bougies).padStart(7)}  ${String(a.n).padStart(6)}  `
    + `${fmt(a.esperance)}  ${fmt(b.esperance)}   `
    + (meilleure ? `${meilleure.k.slice(0, 22)} ${meilleure.e >= 0 ? '+' : ''}${meilleure.e.toFixed(3)} (${meilleure.n})` : '—'));
}

F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15, parSymbole: {} });
console.log('\nUne espérance positive avec glissement = 1 spread est le seul critère qui compte.');
