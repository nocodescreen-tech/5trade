/**
 * RÉSISTANCE AU GLISSEMENT D'EXÉCUTION.
 *
 * Tous les chiffres publiés jusqu'ici supposent un remplissage AU NIVEAU EXACT :
 * l'entrée, le stop et les objectifs sont touchés au prix demandé. Ça n'existe
 * pas. Ici on facture un glissement à l'entrée ET à la sortie, en unités de prix,
 * et on regarde ce qu'il reste.
 *
 * Usage : node tools/test-glissement.js [BTC-USD] [1h] [4]
 */
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');
const V = require('../api/validite');

const [sym = 'BTC-USD', tf = '1h', pasArg = '4'] = process.argv.slice(2);
const pas = Math.max(1, Number(pasArg) || 4);
const profil = [{ id: 'p', titre: 'T', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {} }];

// Un spread de référence par marché, puis des glissements croissants.
const base = { 'BTC-USD': 12, 'GC=F': 0.30, 'EURUSD=X': 0.00012 }[sym] ?? 0.001;
const NIVEAUX = [0, 0.5, 1, 2].map(k => +(base * k).toFixed(6));

const cle = t => String(t.concept || t.strategie || t.nom || '?').replace(/\s+[\d.,]+.*$/, '').trim();
const bougies = H.charger('yahoo', sym, tf);
if (!bougies || bougies.length < 500) throw new Error(`historique insuffisant : ${sym} ${tf}`);

console.log(`${sym} ${tf} · ${bougies.length} bougies · spread de référence ${base}`);
console.log('\n  glissement   trades   total R   espérance   Breaker    FVG     coût moyen');
console.log('  ' + '─'.repeat(72));

for (const g of NIVEAUX) {
  F.configurer({ defaut: 0, commissionDefaut: 0, parSymbole: { [sym]: { spread: base, glissement: g } } });
  const r = B.lancer(bougies, { symbol: sym, timeframe: tf },
    { profils: profil, pas, maxBougies: bougies.length, plafond: 20000,
      limiteTrades: 1e6, modele: false });
  const tr = (r.trades || []).filter(t => Number.isFinite(t.r));
  if (!tr.length) { console.log(`  ${String(g).padEnd(11)}  aucun trade (tout est écarté par le coût)`); continue; }

  const parFamille = new Map();
  for (const t of tr) {
    const k = cle(t);
    if (!parFamille.has(k)) parFamille.set(k, []);
    parFamille.get(k).push(t.r);
  }
  const moy = k => {
    const a = parFamille.get(k);
    return a && a.length >= 20 ? (a.reduce((x, y) => x + y, 0) / a.length) : null;
  };
  const total = tr.reduce((a, t) => a + t.r, 0);
  const coutMoyen = tr.reduce((a, t) => a + Math.abs(t.frais ? t.frais.enR : 0), 0) / tr.length;
  const f = (v, n = 3) => (v === null ? '—' : v.toFixed(n).padStart(7));

  console.log(`  ${String(g).padEnd(11)}  ${String(tr.length).padStart(6)}  `
    + `${total.toFixed(1).padStart(8)}  ${(total / tr.length).toFixed(4).padStart(9)}  `
    + `${f(moy('Breaker'))}  ${f(moy('FVG'))}   ${coutMoyen.toFixed(4)} R`);
}

F.configurer({ defaut: 0, commissionDefaut: 0, parSymbole: {} });
console.log('\nLecture : le glissement est facturé à l\'entrée ET à la sortie (×2).');
