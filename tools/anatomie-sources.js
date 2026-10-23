/**
 * ANATOMIE DES SIGNAUX DE STRATÉGIE — pourquoi perdent-ils ?
 *
 * Mesuré : sur NQ 1d, 10 ans, frais + glissement, la source « strategie » vaut
 * −0,1923 R par trade quand motif vaut +0,0797 et structure +0,1105.
 *
 * Avant de corriger, on regarde ce qu'ils sont : statut, rapport risque/rendement,
 * issue, sens, durée. La cause commande le remède.
 */
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');

const SYM = process.argv[2] || 'NQ=F';
const SPREAD = { 'NQ=F': 1, 'YM=F': 1, 'ES=F': .25, '^GDAXI': 2, '^FTSE': 1, '^N225': 5, '^HSI': 5, 'RTY=F': .1 }[SYM] || 1;

const profils = [{
  id: 'p', titre: 'Toutes règles', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {}
}];

const b = H.charger('yahoo', SYM, '1d');
F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0,
  partMax: 0.15, parSymbole: { [SYM]: { spread: SPREAD, glissement: SPREAD } } });
const r = B.lancer(b, { symbol: SYM, timeframe: '1d' },
  { profils, pas: 1, maxBougies: b.length, plafond: 20000, limiteTrades: 1e6, modele: false });
F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15, parSymbole: {} });

const par = src => (r.trades || []).filter(t => (t.source || '') === src);
const stat = (arr, f) => {
  const m = new Map();
  for (const t of arr) { const k = f(t); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b2) => b2[1] - a[1]);
};
const moy = (arr, f) => arr.length ? arr.reduce((a, t) => a + f(t), 0) / arr.length : 0;

for (const src of ['strategie', 'motif', 'structure']) {
  const ts = par(src);
  if (!ts.length) { console.log(`\n${src} : aucun trade`); continue; }
  const esp = moy(ts, t => t.r);
  console.log(`\n══ ${src.toUpperCase()} — ${ts.length} trades · ${esp >= 0 ? '+' : ''}${esp.toFixed(4)} R`);
  console.log('   statut     :', stat(ts, t => t.status || '?').map(([k, n]) => `${k} ${n}`).join(' · '));
  console.log('   issue      :', stat(ts, t => t.resultat).map(([k, n]) => `${k} ${n}`).join(' · '));
  console.log('   sens       :', stat(ts, t => t.sens).map(([k, n]) => `${k} ${n}`).join(' · '));
  console.log('   rr moyen   :', moy(ts, t => Number(t.rr) || 0).toFixed(2));
  console.log('   durée moy. :', moy(ts, t => Number(t.bougiesSuivies) || 0).toFixed(1), 'bougies');
  // Espérance par tranche de rr : le rapport décide-t-il du signe ?
  const tranches = [[0, .5], [.5, 1], [1, 1.5], [1.5, 2], [2, 99]];
  const parRR = tranches.map(([a, c]) => {
    const g = ts.filter(t => { const x = Number(t.rr); return x >= a && x < c; });
    return g.length ? `rr ${a}-${c}: ${moy(g, t => t.r).toFixed(3)} R (${g.length})` : null;
  }).filter(Boolean);
  console.log('   par rr     :', parRR.join(' · '));
  // Espérance pour les seuls confirmés : le seuil de la stratégie est-il suivi ?
  const conf = ts.filter(t => t.status === 'confirme');
  const surv = ts.filter(t => t.status === 'surveiller');
  console.log(`   confirmés   : ${conf.length} trades · ${moy(conf, t => t.r).toFixed(4)} R`);
  console.log(`   à surveiller: ${surv.length} trades · ${moy(surv, t => t.r).toFixed(4)} R`);
}
