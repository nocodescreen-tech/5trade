/**
 * COMBIEN DE MARCHÉS INDÉPENDANTS, VRAIMENT ?
 *
 * Mon annonce « 7 indices sur 8 positifs, 3,5 % de chance par hasard » suppose
 * huit tirages indépendants. C'est faux si les marchés bougent ensemble : NQ, ES,
 * YM et RTY sont quatre façons de dire « actions américaines », et DAX, FTSE,
 * N225, HSI en sont des reflets.
 *
 * On mesure la corrélation des rendements quotidiens deux à deux, puis le nombre
 * effectif de marchés indépendants (N_eff = N² / Σ ρ², la formule de la taille
 * d'échantillon effective). On recalcule ensuite la probabilité binomiale avec
 * N_eff au lieu de N.
 */
const H = require('../api/historique');

const INDICES = ['NQ=F', 'YM=F', 'ES=F', 'RTY=F', '^GDAXI', '^FTSE', '^N225', '^HSI'];

// Rendements quotidiens, alignés sur les dates communes.
const series = {};
for (const s of INDICES) {
  const b = H.charger('yahoo', s, '1d');
  if (!b || b.length < 200) continue;
  series[s] = new Map();
  for (let i = 1; i < b.length; i++) {
    if (!b[i - 1].c) continue;
    const jour = new Date(b[i].t).toISOString().slice(0, 10);
    series[s].set(jour, (b[i].c - b[i - 1].c) / b[i - 1].c);
  }
}

const noms = Object.keys(series);
const communs = [...series[noms[0]].keys()].filter(t => noms.every(n => series[n].has(t)));
const r = noms.map(n => communs.map(t => series[n].get(t)));

const correlation = (a, b) => {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return cov / Math.sqrt(va * vb);
};

console.log(`\n${noms.length} indices · ${communs.length} jours communs\n`);
console.log('  corrélation des rendements quotidiens');
console.log('  ' + ' '.repeat(9) + noms.map(n => n.replace('^', '').slice(0, 6).padStart(7)).join(''));
let sommeCarres = 0, paires = 0;
for (let i = 0; i < noms.length; i++) {
  let ligne = '  ' + noms[i].replace('^', '').padEnd(9);
  for (let j = 0; j < noms.length; j++) {
    if (i === j) { ligne += '      —'; continue; }
    const c = correlation(r[i], r[j]);
    ligne += c.toFixed(2).padStart(7);
    if (j > i) { sommeCarres += c * c; paires++; }
  }
  console.log(ligne);
}

const N = noms.length;
const moyenne = sommeCarres / paires;
// N_eff : taille d'échantillon effective pour des variables corrélées.
const nEff = N * N / (N + 2 * sommeCarres);

console.log(`\n  corrélation moyenne (paires) : ${Math.sqrt(moyenne).toFixed(3)}`);
console.log(`  marchés annoncés             : ${N}`);
console.log(`  marchés RÉELLEMENT indépendants : ${nEff.toFixed(1)}`);

// Probabilité de voir 7/8 positifs si les marchés étaient indépendants…
const binom = (k, n, p) => {
  let s = 0;
  for (let i = k; i <= n; i++) {
    let c = 1;
    for (let j = 0; j < i; j++) c = c * (n - j) / (j + 1);
    s += c * Math.pow(p, i) * Math.pow(1 - p, n - i);
  }
  return s;
};
console.log(`\n  P(7/8 positifs | 8 marchés indépendants) : ${(binom(7, 8, 0.5) * 100).toFixed(1)} %`);
console.log(`  P(7/8 positifs | ${nEff.toFixed(1)} marchés effectifs)    : `
  + `${(binom(Math.round(7 * nEff / 8), Math.round(nEff), 0.5) * 100).toFixed(1)} %`);
