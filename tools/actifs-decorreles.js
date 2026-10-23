/**
 * L'AVANTAGE EXISTE-T-IL AILLEURS QUE DANS LES ACTIONS ?
 *
 * Le résultat « +4,86 % du risque par trade » a été obtenu sur huit indices
 * d'actions corrélés à 0,53 en moyenne — soit 2,7 paris indépendants. Rien ne dit
 * que c'est un avantage de la méthode plutôt qu'un reflet de la tendance
 * haussière des actions.
 *
 * Test : les MÊMES choix figés (quotidien, motifs + structure, glissement d'un
 * spread) appliqués à des actifs décorrélés — obligations, dollar, cuivre, blé,
 * maïs, yen. Si l'avantage apparaît là où la corrélation aux actions est faible,
 * c'est un avantage. Sinon, c'était du bêta déguisé.
 *
 * Usage : node tools/actifs-decorreles.js
 */
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');
const V = require('../api/validite');

// Spread estimé en unités de prix (un tick ou le spread retail typique).
const ACTIFS = {
  'TLT': { spread: 0.02, nom: 'Obligations 20+ ans' },
  'ZN=F': { spread: 0.015625, nom: 'Note 10 ans' },
  'DX-Y.NYB': { spread: 0.02, nom: 'Dollar index' },
  'HG=F': { spread: 0.0005, nom: 'Cuivre' },
  'ZW=F': { spread: 0.25, nom: 'Blé' },
  'ZC=F': { spread: 0.25, nom: 'Maïs' },
  '6J=F': { spread: 0.0000005, nom: 'Yen' }
};
// Panier de référence : actions.
const ACTIONS = ['NQ=F', 'YM=F', 'ES=F', 'RTY=F', '^GDAXI', '^FTSE', '^N225', '^HSI'];

const profils = [{ id: 'p', titre: 'T', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {} }];

/** Rendements quotidiens par date civile. */
function rendements(sym) {
  const b = H.charger('yahoo', sym, '1d');
  if (!b || b.length < 100) return null;
  const m = new Map();
  for (let i = 1; i < b.length; i++) {
    if (!b[i - 1].c) continue;
    m.set(new Date(b[i].t).toISOString().slice(0, 10), (b[i].c - b[i - 1].c) / b[i - 1].c);
  }
  return m;
}
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

// Panier d'actions : moyenne des rendements disponibles à chaque date.
const panier = new Map();
for (const s of ACTIONS) {
  const r = rendements(s); if (!r) continue;
  for (const [j, v] of r) {
    const e = panier.get(j) || { somme: 0, n: 0 };
    panier.set(j, { somme: e.somme + v, n: e.n + 1 });
  }
}

console.log('\n  actif        trades   espérance    total R   corr. actions   verdict');
console.log('  ' + '─'.repeat(78));

const tous = [], marchés = [];
for (const [sym, cfg] of Object.entries(ACTIFS)) {
  const b = H.charger('yahoo', sym, '1d');
  if (!b || b.length < 300) { console.log(`  ${sym.padEnd(11)}  historique insuffisant`); continue; }

  F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15,
    parSymbole: { [sym]: { spread: cfg.spread, glissement: cfg.spread } } });
  const r = B.lancer(b, { symbol: sym, timeframe: '1d' },
    { profils, pas: 1, maxBougies: b.length, plafond: 20000, limiteTrades: 1e6,
      modele: false, sources: ['motif', 'structure'], regime: process.env.REGIME === '1' });
  const tr = (r.trades || []).filter(t => Number.isFinite(t.r));
  if (tr.length < 100) { console.log(`  ${sym.padEnd(11)}  ${tr.length} trades — trop peu`); continue; }

  const rs = tr.map(t => t.r);
  const e = rs.reduce((a, x) => a + x, 0) / rs.length;

  // Corrélation de cet actif avec le panier d'actions, sur les dates communes.
  const rd = rendements(sym);
  const x = [], y = [];
  for (const [j, v] of rd) {
    const p = panier.get(j);
    if (p) { x.push(v); y.push(p.somme / p.n); }
  }
  const c = x.length > 100 ? corr(x, y) : null;

  tous.push(...rs);
  marchés.push({ sym, e, sharpe: V.sharpe(rs), n: tr.length });
  const verdict = e > 0 ? (c !== null && Math.abs(c) < 0.3 ? 'positif ET décorrélé' : 'positif') : 'négatif';
  console.log(`  ${sym.padEnd(11)}  ${String(tr.length).padStart(6)}  `
    + `${((e >= 0 ? '+' : '') + (e * 100).toFixed(2) + ' %').padStart(11)}  `
    + `${rs.reduce((a, z) => a + z, 0).toFixed(0).padStart(8)}  `
    + `${(c === null ? '—' : c.toFixed(2)).padStart(13)}   ${verdict}`);
}
F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15, parSymbole: {} });

if (tous.length) {
  const e = tous.reduce((a, x) => a + x, 0) / tous.length;
  const variance = V.moments(marchés.map(m => m.sharpe)).ecart ** 2 || 4e-4;
  console.log(`\n  PORTEFEUILLE DÉCORRÉLÉ : ${tous.length} trades · `
    + `${(e * 100).toFixed(2)} % du risque par trade · `
    + `${marchés.filter(m => m.e > 0).length}/${marchés.length} marchés positifs`);
  console.log(`  DSR (déflaté ${marchés.length}) : ${V.dsr(tous, marchés.length, variance).psr.toFixed(3)}`);
  console.log('\n  Un actif « positif ET décorrélé » est la preuve cherchée :');
  console.log('  l’avantage ne dépend alors pas de la tendance des actions.');
}
