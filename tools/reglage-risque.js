/**
 * COMPROMIS RENDEMENT / DRAWDOWN — le seul tableau qui décide du réglage.
 *
 * Le portefeuille d'indices rend 16,5 %/an avec -34,8 % de drawdown : un ratio de
 * 0,47, insuffisant pour être tradé sereinement. Le levier est le risque par
 * trade et le nombre de positions simultanées. On balaie les deux.
 *
 * Les trades sont construits UNE fois, puis réutilisés : six simulations coûtent
 * six compositions, pas six backtests.
 */
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');
const R = require('../api/risque');

const INDICES = {
  'NQ=F': 1.00, 'YM=F': 1.00, 'ES=F': 0.25, 'RTY=F': 0.10,
  '^GDAXI': 2.0, '^FTSE': 1.0, '^N225': 5.0, '^HSI': 5.0
};
const profil = [{ id: 'p', titre: 'T', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {} }];

const tous = [];
for (const [sym, spread] of Object.entries(INDICES)) {
  const bougies = H.charger('yahoo', sym, '1d');
  if (!bougies || bougies.length < 300) continue;
  F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0,
    partMax: 0.15, parSymbole: { [sym]: { spread, glissement: spread } } });
  const r = B.lancer(bougies, { symbol: sym, timeframe: '1d' },
    { profils: profil, pas: 1, maxBougies: bougies.length, plafond: 20000,
      limiteTrades: 1e6, modele: false });
  for (const t of (r.trades || [])) {
    if (Number.isFinite(t.r) && Number.isFinite(t.at)) {
      tous.push({ at: t.at, symbol: sym, entree: t.entree, stop: t.stop,
        resultat: t.resultat, r: t.r, leveLe: t.leveLe });
    }
  }
}
F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15, parSymbole: {} });
tous.sort((a, b) => a.at - b.at);

const annees = ((tous.at(-1).at - tous[0].at) / (365.25 * 86400000));
console.log(`\n${tous.length} trades · ${annees.toFixed(1)} ans · capital 1000\n`);
console.log('  risque/trade  positions   pris    rendement/an   drawdown   ratio   verdict');
console.log('  ' + '─'.repeat(84));

let meilleur = null;
for (const pct of [0.25, 0.5, 1, 2]) {
  for (const maxSim of [3, 5, 10]) {
    R.configurer({ risquePct: pct, maxSimultanes: maxSim, maxRisqueMarchePct: 2, maxRisqueTotalPct: 5 });
    const s = R.simuler(tous, { capital: 1000, risquePct: pct });
    const cagr = (Math.pow(s.capital / 1000, 1 / annees) - 1) * 100;
    const dd = Math.abs(s.drawdownPct);
    const ratio = dd > 0 ? cagr / dd : Infinity;
    const verdict = ratio >= 1 ? 'bon' : ratio >= 0.5 ? 'acceptable' : 'trop risqué';
    console.log(`  ${String(pct).padStart(8)} %  ${String(maxSim).padStart(9)}   `
      + `${String(s.prises).padStart(5)}   ${cagr.toFixed(1).padStart(9)} %   `
      + `${dd.toFixed(1).padStart(6)} %   ${ratio.toFixed(2).padStart(5)}   ${verdict}`);
    if (!meilleur || ratio > meilleur.ratio) meilleur = { pct, maxSim, cagr, dd, ratio, prises: s.prises };
  }
}
R.configurer({ risquePct: 1, maxSimultanes: 5, maxRisqueMarchePct: 2, maxRisqueTotalPct: 5 });

console.log(`\n  MEILLEUR COMPROMIS : risque ${meilleur.pct} % · ${meilleur.maxSim} positions`
  + ` → ${meilleur.cagr.toFixed(1)} %/an pour ${meilleur.dd.toFixed(1)} % de drawdown`
  + ` (ratio ${meilleur.ratio.toFixed(2)}, ${meilleur.prises} prises)`);
console.log('  Un ratio rendement/drawdown ≥ 1 est le minimum pour être tradable sereinement.');
