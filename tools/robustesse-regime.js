/**
 * LE FILTRE DÉPEND-IL DU RÉGLAGE ?
 *
 * Un avantage qui n'existe qu'avec une moyenne 200 est un réglage chanceux. Un
 * avantage qui survit à 100, 150, 200, 250, 300 et à plusieurs pentes est une
 * propriété du marché.
 *
 * Astuce de coût : le filtre ne fait qu'INCLURE ou EXCLURE des trades déjà
 * calculés. On lance donc le backtest UNE fois sans filtre, puis on applique
 * chaque réglage en post-traitement. Quinze configurations coûtent un backtest,
 * pas quinze.
 *
 * Usage : node tools/robustesse-regime.js
 */
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');

const MARCHES = {
  'GC=F': 0.30, 'SI=F': 0.005, 'CT=F': 0.01, 'KC=F': 0.05, 'HG=F': 0.0005,
  'NQ=F': 1, 'ES=F': 0.25
};
const profils = [{ id: 'p', titre: 'T', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {} }];

// Trades bruts + série de chaque marché, chargés une seule fois.
const parMarche = {};
for (const [sym, spread] of Object.entries(MARCHES)) {
  const b = H.charger('yahoo', sym, '1d');
  if (!b || b.length < 400) continue;
  F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15,
    parSymbole: { [sym]: { spread, glissement: spread } } });
  const r = B.lancer(b, { symbol: sym, timeframe: '1d' },
    { profils, pas: 1, maxBougies: b.length, plafond: 20000, limiteTrades: 1e6,
      modele: false, sources: ['motif', 'structure'] });
  const index = new Map();
  for (let i = 0; i < b.length; i++) index.set(b[i].t, i);
  parMarche[sym] = { bougies: b, index, trades: (r.trades || []).filter(t => Number.isFinite(t.r)) };
}
F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15, parSymbole: {} });

/** Moyenne mobile et pente, calculées SANS le futur, jusqu'à l'index i. */
function regime(b, i, periodeSma, periodePente) {
  if (i < periodeSma - 1 + periodePente) return null;
  const m = (k) => {
    let s = 0;
    for (let j = k - periodeSma + 1; j <= k; j++) s += b[j].c;
    return s / periodeSma;
  };
  const maintenant = m(i), avant = m(i - periodePente);
  if (!avant) return null;
  const pente = (maintenant - avant) / avant;
  return {
    haussier: b[i].c > maintenant && pente > 0,
    baissier: b[i].c < maintenant && pente < 0
  };
}

const esperance = (arr) => {
  if (!arr.length) return null;
  return { n: arr.length, e: arr.reduce((a, x) => a + x, 0) / arr.length };
};

const sans = [];
for (const m of Object.values(parMarche)) sans.push(...m.trades.map(t => t.r));
const base = esperance(sans);
console.log(`\n  sans filtre : ${base.n} trades · ${(base.e * 100).toFixed(2)} % du risque\n`);
console.log('  moyenne   pente   trades   espérance   vs sans filtre');
console.log('  ' + '─'.repeat(58));

let signes = new Set();
for (const sma of [100, 150, 200, 250, 300]) {
  for (const pente of [10, 20, 40]) {
    const gardes = [];
    for (const [sym, m] of Object.entries(parMarche)) {
      for (const t of m.trades) {
        const i = m.index.get(t.at);
        if (i === undefined) continue;
        const rg = regime(m.bougies, i, sma, pente);
        if (!rg) continue;
        const aligne = (t.sens === 'long' && rg.haussier) || (t.sens === 'short' && rg.baissier);
        if (aligne) gardes.push(t.r);
      }
    }
    const g = esperance(gardes);
    if (!g) { console.log(`  ${String(sma).padStart(7)}   ${String(pente).padStart(5)}   aucun trade`); continue; }
    const gain = (g.e / base.e - 1) * 100;
    signes.add(g.e > 0 ? '+' : '-');
    console.log(`  ${String(sma).padStart(7)}   ${String(pente).padStart(5)}   `
      + `${String(g.n).padStart(6)}   ${((g.e * 100).toFixed(2) + ' %').padStart(9)}   `
      + `${(gain >= 0 ? '+' : '') + gain.toFixed(0)} %`);
  }
}

console.log(`\n  ${signes.size === 1 && signes.has('+')
  ? 'TOUS les réglages sont positifs : le filtre ne dépend pas d’une valeur.'
  : 'ATTENTION : certains réglages changent le signe — l’avantage est fragile.'}`);
