/**
 * L'AVANTAGE EST-IL UNE TENDANCE DÉGUISÉE ?
 *
 * Constat : les mêmes règles gagnent sur les indices d'actions et le cuivre
 * (+4,86 % et +8,76 % du risque par trade), perdent sur les obligations, le
 * dollar, le blé, le maïs et le yen (−3,8 % à −9,3 %). Ces derniers sont des
 * marchés sans tendance persistante.
 *
 * Hypothèse testable : les signaux ne gagnent que lorsque le marché est déjà en
 * tendance haussière. Si c'est vrai, l'« avantage » est du bêta — et il
 * disparaîtra le jour où les actions cesseront de monter.
 *
 * On classe chaque trade par régime au moment de l'entrée :
 *   haussier : prix au-dessus de sa moyenne 200 et moyenne en hausse
 *   baissier  : prix en dessous et moyenne en baisse
 *   range     : le reste
 *
 * Usage : node tools/regime.js [actif]
 */
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');

const SPREADS = {
  'NQ=F': 1, 'YM=F': 1, 'ES=F': .25, 'RTY=F': .1, '^GDAXI': 2, '^FTSE': 1,
  '^N225': 5, '^HSI': 5, 'HG=F': .0005, 'TLT': .02, 'ZN=F': .015625,
  'DX-Y.NYB': .02, 'ZW=F': .25, 'ZC=F': .25, '6J=F': .0000005
};
const cible = process.argv[2] || null;
const liste = cible ? cible.split(String.fromCharCode(44)).map(x => x.trim()).filter(Boolean) : Object.keys(SPREADS);

const profils = [{ id: 'p', titre: 'T', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {} }];

const parRegime = { haussier: [], baissier: [], range: [] };

for (const sym of liste) {
  const spread = SPREADS[sym];
  const b = H.charger('yahoo', sym, '1d');
  if (!b || b.length < 400) continue;

  // Moyenne 200 et sa pente, calculées SANS le futur.
  const sma = new Array(b.length).fill(null), pente = new Array(b.length).fill(null);
  let somme = 0;
  for (let i = 0; i < b.length; i++) {
    somme += b[i].c;
    if (i >= 200) somme -= b[i - 200].c;
    if (i >= 199) {
      sma[i] = somme / 200;
      if (i >= 219) pente[i] = (sma[i] - sma[i - 20]) / sma[i - 20];
    }
  }

  F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15,
    parSymbole: { [sym]: { spread, glissement: spread } } });
  const r = B.lancer(b, { symbol: sym, timeframe: '1d' },
    { profils, pas: 1, maxBougies: b.length, plafond: 20000, limiteTrades: 1e6,
      modele: false, sources: ['motif', 'structure'] });

  // Index de la bougie d'entrée, pour retrouver le régime.
  const parTemps = new Map();
  for (let i = 0; i < b.length; i++) parTemps.set(b[i].t, i);

  for (const t of (r.trades || [])) {
    if (!Number.isFinite(t.r)) continue;
    const i = parTemps.get(t.at);
    if (i === undefined || sma[i] === null || pente[i] === null) continue;
    const haussier = b[i].c > sma[i] && pente[i] > 0;
    const baissier = b[i].c < sma[i] && pente[i] < 0;
    const regime = haussier ? 'haussier' : baissier ? 'baissier' : 'range';

    // Pour un ACHAT, une tendance haussière porte ; pour une VENTE, c'est
    // l'inverse. On mesure donc le régime DANS LE SENS DU TRADE.
    const porteur = (t.sens === 'long' && regime === 'haussier')
      || (t.sens === 'short' && regime === 'baissier');
    const contraire = (t.sens === 'long' && regime === 'baissier')
      || (t.sens === 'short' && regime === 'haussier');
    const cle = porteur ? 'haussier' : contraire ? 'baissier' : 'range';
    parRegime[cle].push({ r: t.r, sym });
  }
}
F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15, parSymbole: {} });

const noms = { haussier: 'dans le sens de la tendance', baissier: 'contre la tendance', range: 'sans tendance' };
console.log(`\n  régime du marché à l’entrée${cible ? ' — ' + cible : ' — tous actifs'}`);
console.log('  ' + '─'.repeat(72));

let total = 0, totalN = 0;
for (const [cle, arr] of Object.entries(parRegime)) {
  if (!arr.length) { console.log(`  ${noms[cle].padEnd(32)} aucun trade`); continue; }
  const e = arr.reduce((a, x) => a + x.r, 0) / arr.length;
  total += arr.reduce((a, x) => a + x.r, 0); totalN += arr.length;
  console.log(`  ${noms[cle].padEnd(32)} ${String(arr.length).padStart(7)} trades · `
    + `${((e >= 0 ? '+' : '') + (e * 100).toFixed(2) + ' %').padStart(9)} du risque · `
    + `${arr.reduce((a, x) => a + x.r, 0).toFixed(0).padStart(6)} R`);
}
console.log(`\n  total : ${totalN} trades · ${(total / totalN * 100).toFixed(2)} % du risque par trade`);

// Verdict : la part du gain qui vient du sens de la tendance.
const porteur = parRegime.haussier.reduce((a, x) => a + x.r, 0);
const contre = parRegime.baissier.reduce((a, x) => a + x.r, 0);
const range = parRegime.range.reduce((a, x) => a + x.r, 0);
const gagnant = Math.max(0, total);
if (gagnant > 0) {
  console.log(`  part du gain venant des trades DANS le sens de la tendance : `
    + `${((porteur / gagnant) * 100).toFixed(0)} %`);
  console.log(`  trades contre la tendance : ${contre.toFixed(0)} R · sans tendance : ${range.toFixed(0)} R`);
}
