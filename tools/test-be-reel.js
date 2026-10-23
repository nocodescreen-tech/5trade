/**
 * LE TEST QUI PEUT TOUT ANNULER : l'avantage de BTC survit-il si un BE vaut 0 ?
 *
 * Un BE (objectif 1 pris puis retour à l'entrée) est crédité de la moitié du
 * premier objectif. Si l'avantage de BTC tient uniquement à cette convention, il
 * n'y a rien à annoncer.
 */
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');
const V = require('../api/validite');

const profils = [{ id: 'p', titre: 'T', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {} }];
const cle = t => String(t.concept || t.strategie || t.nom || '?').replace(/\s+[\d.,]+.*$/, '').trim();

for (const [sym, tf, pas, spread] of [['BTC-USD', '1h', 4, 12], ['GC=F', '1h', 3, 0.30]]) {
  const b = H.charger('yahoo', sym, tf);
  F.configurer({ defaut: 0, commissionDefaut: 0, parSymbole: { [sym]: { spread } } });
  const r = B.lancer(b, { symbol: sym, timeframe: tf },
    { profils, pas, maxBougies: b.length, plafond: 20000, limiteTrades: 1e6, modele: false });
  const tr = (r.trades || []).filter(t => Number.isFinite(t.r));

  const sommeBE = tr.filter(t => t.resultat === 'be').reduce((a, t) => a + t.r, 0);
  const total = tr.reduce((a, t) => a + t.r, 0);
  console.log(`\n══ ${sym} — ${tr.length} trades`);
  console.log(`  total avec convention BE : ${total.toFixed(2)} R (${(total / tr.length).toFixed(4)} R/trade)`);
  console.log(`  dont BE (${tr.filter(t => t.resultat === 'be').length} trades) : ${sommeBE.toFixed(2)} R`);
  console.log(`  total avec BE = 0        : ${(total - sommeBE).toFixed(2)} R (${((total - sommeBE) / tr.length).toFixed(4)} R/trade)`);

  // Par concept, les deux conventions, et le DSR de la version honnête.
  const groupes = new Map();
  for (const t of tr) {
    const k = cle(t);
    if (!groupes.has(k)) groupes.set(k, { avec: [], sans: [] });
    const g = groupes.get(k);
    g.avec.push(t.r);
    g.sans.push(t.resultat === 'be' ? 0 : t.r);
  }
  const configs = [...groupes.entries()].filter(([, g]) => g.avec.length >= 30);
  const ligne = (nom, rs) => {
    const d = V.dsr(rs, configs.length, V.moments(configs.map(([, g]) =>
      V.sharpe(nom === 'avec' ? g.avec : g.sans))).ecart ** 2 || 1);
    const e = V.moments(rs);
    return `${e.moyenne.toFixed(3)} R (PSR ${d ? d.psr.toFixed(3) : '—'}${d && d.psr > 0.95 ? ' OUI' : ''})`;
  };
  console.log('  concept'.padEnd(26), 'avec BE'.padStart(26), '   sans BE');
  for (const [k, g] of configs.sort((a, b) => V.moments(b[1].avec).moyenne - V.moments(a[1].avec).moyenne)) {
    console.log('  ' + k.slice(0, 24).padEnd(24), ligne('avec', g.avec).padStart(26), '  ', ligne('sans', g.sans));
  }
  F.configurer({ defaut: 0, commissionDefaut: 0, parSymbole: {} });
}
