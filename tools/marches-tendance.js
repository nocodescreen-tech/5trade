/**
 * QUELS MARCHÉS TENDENT SANS ÊTRE LES ACTIONS ?
 *
 * Constat : les mêmes règles valent +4,86 % du risque par trade sur les indices
 * d'actions et −2,02 % sur un panier décorrélé. Le facteur commun n'est donc pas
 * « les actions » mais « la tendance » : ça gagne où ça tend, ça perd où ça
 * revient à la moyenne.
 *
 * On mesure ici chaque actif DEUX fois — sans puis avec le filtre de tendance —
 * pour trouver ceux qui tendent vraiment, hors actions.
 *
 * Usage :
 *   node tools/marches-tendance.js                 tous
 *   node tools/marches-tendance.js HG=F,CL=F,SI=F  une sélection
 */
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');
const V = require('../api/validite');

const ACTIFS = {
  'HG=F': { spread: 0.0005, nom: 'Cuivre' },
  'SI=F': { spread: 0.005, nom: 'Argent' },
  'PL=F': { spread: 0.10, nom: 'Platine' },
  'CL=F': { spread: 0.02, nom: 'Pétrole WTI' },
  'NG=F': { spread: 0.001, nom: 'Gaz naturel' },
  'ZS=F': { spread: 0.25, nom: 'Soja' },
  'KC=F': { spread: 0.05, nom: 'Café' },
  'SB=F': { spread: 0.01, nom: 'Sucre' },
  'CT=F': { spread: 0.01, nom: 'Coton' },
  'GC=F': { spread: 0.30, nom: 'Or' }
};
const ACTIONS = ['NQ=F', 'YM=F', 'ES=F', 'RTY=F', '^GDAXI', '^FTSE', '^N225', '^HSI'];

const demande = process.argv[2];
const liste = demande ? demande.split(',').map(x => x.trim()).filter(Boolean) : Object.keys(ACTIFS);
const profils = [{ id: 'p', titre: 'T', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {} }];

const rendements = (sym) => {
  const b = H.charger('yahoo', sym, '1d');
  if (!b || b.length < 100) return null;
  const m = new Map();
  for (let i = 1; i < b.length; i++) {
    if (!b[i - 1].c) continue;
    m.set(new Date(b[i].t).toISOString().slice(0, 10), (b[i].c - b[i - 1].c) / b[i - 1].c);
  }
  return m;
};
const corr = (a, b) => {
  const n = Math.min(a.length, b.length);
  const ma = a.slice(0, n).reduce((x, y) => x + y, 0) / n;
  const mb = b.slice(0, n).reduce((x, y) => x + y, 0) / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2;
  }
  return cov / Math.sqrt(va * vb);
};

// Panier d'actions de référence.
const panier = new Map();
for (const s of ACTIONS) {
  const r = rendements(s); if (!r) continue;
  for (const [j, v] of r) {
    const e = panier.get(j) || { somme: 0, n: 0 };
    panier.set(j, { somme: e.somme + v, n: e.n + 1 });
  }
}

const mesurer = (sym, spread, regime) => {
  const b = H.charger('yahoo', sym, '1d');
  if (!b || b.length < 300) return null;
  F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15,
    parSymbole: { [sym]: { spread, glissement: spread } } });
  const r = B.lancer(b, { symbol: sym, timeframe: '1d' },
    { profils, pas: 1, maxBougies: b.length, plafond: 20000, limiteTrades: 1e6,
      modele: false, sources: ['motif', 'structure'], regime });
  const tr = (r.trades || []).filter(t => Number.isFinite(t.r));
  if (tr.length < 80) return null;
  return { n: tr.length, e: tr.reduce((a, t) => a + t.r, 0) / tr.length, sharpe: V.sharpe(tr.map(t => t.r)) };
};

console.log('\n  actif         nom            corr.   sans filtre      avec filtre     verdict');
console.log('  ' + '─'.repeat(84));

const retenus = [];
for (const sym of liste) {
  const cfg = ACTIFS[sym] || { spread: 0.01, nom: sym };
  const a = mesurer(sym, cfg.spread, false);
  const b2 = mesurer(sym, cfg.spread, true);
  if (!a) { console.log(`  ${sym.padEnd(12)}  ${cfg.nom.padEnd(13)}  échantillon trop court`); continue; }

  const rd = rendements(sym), x = [], y = [];
  for (const [j, v] of rd) { const p = panier.get(j); if (p) { x.push(v); y.push(p.somme / p.n); } }
  const c = x.length > 100 ? corr(x, y) : null;

  const fmt = m => (m ? `${(m.e * 100).toFixed(1)} %`.padStart(12) : '           —');
  const verdict = !b2 ? '—'
    : b2.e > 0 && a.e <= 0 ? 'LE FILTRE LE SAUVE'
      : b2.e > 0 && Math.abs(c ?? 1) < 0.3 ? 'tend ET décorrélé'
        : b2.e > 0 ? 'positif, corrélé' : 'négatif';

  if (b2 && b2.e > 0 && Math.abs(c ?? 1) < 0.3) retenus.push({ sym, nom: cfg.nom, corr: c, ...b2 });

  console.log(`  ${sym.padEnd(12)}  ${cfg.nom.padEnd(13)}  `
    + `${(c === null ? '—' : c.toFixed(2)).padStart(6)}  ${fmt(a)}  ${fmt(b2)}   ${verdict}`);
}
F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15, parSymbole: {} });

if (retenus.length) {
  const tous = [];
  // Le portefeuille des retenus : moyenne pondérée par le nombre de trades.
  for (const r of retenus) for (let i = 0; i < r.n; i++) tous.push(r.e);
  const e = tous.reduce((a, x) => a + x, 0) / tous.length;
  console.log(`\n  RETENUS (positifs avec filtre ET corrélation < 0,3 aux actions) :`);
  for (const r of retenus) console.log(`    ${r.nom.padEnd(14)} ${r.n} trades · `
    + `${(r.e * 100).toFixed(2)} % du risque · corr ${r.corr.toFixed(2)}`);
  console.log(`  → ${retenus.length} marché(s), ${tous.length} trades, ${(e * 100).toFixed(2)} % du risque en moyenne`);
  console.log('  Ces marchés-là comptent comme des paris vraiment indépendants des actions.');
} else {
  console.log('\n  Aucun marché positif, filtré, et décorrélé des actions.');
  console.log('  L’avantage reste donc attaché aux tendances actions/cuivre.');
}
