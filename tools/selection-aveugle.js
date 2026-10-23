/**
 * LE BIAIS DE SÉLECTION, TESTÉ POUR DE VRAI.
 *
 * Les 5 matières premières du portefeuille (or, argent, coton, café, cuivre) ont
 * été gardées PARCE QU'ELLES GAGNAIENT sur 2016-2026. Un portefeuille choisi
 * après avoir vu les résultats est optimiste par construction.
 *
 * Test honnête : on classe les 10 matières premières uniquement sur 2016-2021,
 * on garde les 5 meilleures, puis on mesure CES 5-là sur 2022-2026 — période qui
 * n'a servi ni à choisir les marchés, ni à choisir le filtre.
 *
 * Si la sélection « aveugle » reproduit la performance, la méthode de choix tient.
 * Sinon, le 77,7 %/an du portefeuille sans actions était un mirage.
 *
 * Usage : node tools/selection-aveugle.js
 */
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');

const MARCHES = {
  'GC=F': 0.30, 'SI=F': 0.005, 'PL=F': 0.10, 'HG=F': 0.0005, 'CL=F': 0.02,
  'NG=F': 0.001, 'ZS=F': 0.25, 'ZC=F': 0.25, 'KC=F': 0.05, 'CT=F': 0.01
};
const profils = [{ id: 'p', titre: 'T', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {} }];
const COUPE = new Date('2022-01-01').getTime();

const mesurer = (sym, spread) => {
  const b = H.charger('yahoo', sym, '1d');
  if (!b || b.length < 400) return null;
  F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15,
    parSymbole: { [sym]: { spread, glissement: spread } } });
  const r = B.lancer(b, { symbol: sym, timeframe: '1d' },
    { profils, pas: 2, maxBougies: b.length, plafond: 20000, limiteTrades: 1e6,
      modele: false, sources: ['motif', 'structure'], regime: true });
  F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, parSymbole: {} });
  const tr = (r.trades || []).filter(t => Number.isFinite(t.r) && Number.isFinite(t.at));
  const avant = tr.filter(t => t.at < COUPE).map(t => t.r);
  const apres = tr.filter(t => t.at >= COUPE).map(t => t.r);
  const moy = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  return { avant: moy(avant), apres: moy(apres), nAvant: avant.length, nApres: apres.length };
};

const res = [];
for (const [sym, spread] of Object.entries(MARCHES)) {
  const m = mesurer(sym, spread);
  if (m && m.avant !== null) res.push({ sym, ...m });
}

console.log('\n  marché   2016-2021 (sert à choisir)   2022-2026 (jamais vu)');
console.log('  ' + '─'.repeat(62));
for (const r of res.sort((a, b) => b.avant - a.avant)) {
  const f = v => (v === null ? '     —' : (v * 100).toFixed(2).padStart(6) + ' %');
  console.log(`  ${r.sym.padEnd(8)} ${f(r.avant)} (${String(r.nAvant).padStart(4)})   ${f(r.apres)} (${String(r.nApres).padStart(4)})`);
}

// Sélection aveugle : top 5 sur la première période seulement.
const top5 = res.slice(0, 5);
const tousApres = res.map(r => r.apres).filter(v => v !== null);
const apresTop5 = top5.map(r => r.apres).filter(v => v !== null);
const moyenne = a => a.reduce((x, y) => x + y, 0) / a.length;

console.log(`\n  TOP 5 choisi sur 2016-2021 : ${top5.map(r => r.sym).join(', ')}`);
console.log(`  leur espérance sur 2022-2026 : ${(moyenne(apresTop5) * 100).toFixed(2)} % du risque par trade`);
console.log(`  espérance de TOUS les marchés sur 2022-2026 : ${(moyenne(tousApres) * 100).toFixed(2)} %`);
console.log(`\n  ${moyenne(apresTop5) > 0
  ? 'La sélection sur le passé reproduit un résultat positif : le choix tient.'
  : 'La sélection sur le passé NE reproduit PAS : le portefeuille était un mirage.'}`);
console.log('  (pas 2 pour tenir dans le temps de calcul — l’ordre de grandeur suffit)');
