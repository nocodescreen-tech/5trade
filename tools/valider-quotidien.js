/**
 * VALIDATION COMPLÈTE EN QUOTIDIEN — l'horizon où la friction devient supportable.
 * DSR, PBO, découpage 60/40, avec spread ET glissement réglés par instrument.
 */
const A = require('../api/analyse');
const F = require('../api/frais');

const SPREAD = { 'NQ=F': 1.00, 'ES=F': 0.25, 'BTC-USD': 12 };

(async () => {
  for (const sym of ['NQ=F', 'ES=F', 'BTC-USD']) {
    const spread = SPREAD[sym];
    // Glissement = 1 spread : hypothèse sévère mais réaliste sur un future liquide.
    F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0,
      partMax: 0.15, parSymbole: { [sym]: { spread, glissement: spread } } });

    const r = await A.analyser({ symbol: sym, tf: '1d', group: 'concept', pas: 1, bougies: 20000 });
    console.log(`\n══ ${sym} 1d · ${r.trades} trades · ${r.bougies} bougies · `
      + `espérance ${r.esperance} R · PBO ${r.pbo === null ? 'n/a' : (r.pbo * 100).toFixed(1) + ' %'}`);
    console.log('  famille'.padEnd(24), 'n'.padStart(5), 'esp.'.padStart(8), 'IS'.padStart(8),
      'OOS'.padStart(8), 'PSR'.padStart(6), 'survit');
    for (const l of r.lignes) {
      console.log('  ' + String(l.nom).slice(0, 22).padEnd(22), String(l.n).padStart(5),
        (l.esperance >= 0 ? '+' : '') + l.esperance.toFixed(4),
        String(l.is ?? '—').padStart(8), String(l.oos ?? '—').padStart(8),
        String(l.psr ?? '—').padStart(6), l.survit ? '  OUI' : '  non');
    }
    const retenus = r.lignes.filter(l => l.survit && l.tient);
    console.log(`  → ${retenus.length} famille(s) survivent ET tiennent hors échantillon`
      + (retenus.length ? ` : ${retenus.map(l => l.nom).join(', ')}` : ''));
  }
  F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15, parSymbole: {} });
})();
