/**
 * Test du verdict économique PAR PAIRE, sans réseau.
 *
 * Question posée : le système lit-il correctement l'impact d'une annonce et
 * rend-il un verdict final pour chaque paire LIÉE à la devise concernée ?
 *
 * Ce script construit un calendrier synthétique dont on connaît la réponse, puis
 * confronte chaque paire à ses devises. Aucune donnée inventée côté production :
 * ici, c'est le jeu d'essai qui est construit, et les attendus sont explicites.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const F = require('../sources/fundamentals');

const maintenant = new Date();
const dans = min => {
  const d = new Date(maintenant.getTime() + min * 60000);
  const mois = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][d.getUTCMonth()];
  const h = d.getUTCHours();
  const suffixe = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return {
    date: `${mois} ${d.getUTCDate()}`,
    heure: `${h12}:${String(d.getUTCMinutes()).padStart(2, '0')}${suffixe}`,
    devise: null, impact: null, titre: null
  };
};
const ev = (minutes, devise, impact, titre) => ({ ...dans(minutes), devise, impact, titre });

const CALENDRIER = [
  ev(10, 'USD', 'high', 'CPI m/m'),
  ev(120, 'EUR', 'high', 'Décision BCE'),
  ev(5, 'JPY', 'medium', 'Tankan'),
  ev(-600, 'USD', 'high', 'NFP (déjà publié)'),
  ev(8, 'GBP', 'low', 'RICS')
];

const PAIRES = ['frxEURUSD', 'frxUSDJPY', 'frxXAUUSD', 'US30', 'BTCUSDT', 'R_75', 'frxGBPUSD'];

console.log('Calendrier de test :');
for (const e of CALENDRIER) {
  const t = F.instantEvenement(e, maintenant);
  console.log(`  ${e.date.padEnd(7)} ${e.heure.padEnd(8)} ${e.devise.padEnd(4)} ${String(e.impact).padEnd(7)} ${e.titre}`
    + `  → ${t === null ? 'instant illisible' : new Date(t).toISOString().slice(11, 16) + ' UTC'}`);
}

console.log('\nVerdict final par paire (fenêtre 30 min) :');
let incoherents = 0;
const attendus = {
  frxEURUSD: true, frxUSDJPY: true, frxXAUUSD: true, US30: true,
  // GBP est « low » dans le jeu d'essai, MAIS frxGBPUSD contient USD : le CPI
  // américain la concerne. C'est le comportement correct — une paire est liée
  // à TOUTES ses devises, pas seulement à la première.
  BTCUSDT: true, R_75: false, frxGBPUSD: true
};

for (const p of PAIRES) {
  const { devises, applicable, raison } = F.devisesDuSymbole(p);
  if (!applicable) {
    const verdict = 'NON APPLICABLE';
    console.log(`  ${p.padEnd(11)} ${devises.join(',') || '—'} → ${verdict}  (${raison})`);
    if (attendus[p] !== false) { incoherents++; console.log('     ✗ attendu : bloquée'); }
    continue;
  }
  const parDevise = devises.map(d => ({ devise: d, v: F.verdictDevise(CALENDRIER, d, { maintenant, fenetreMin: 30 }) }));
  const bloquante = parDevise.find(x => x.v.bloque);
  const verdict = bloquante ? `BLOQUÉE (${bloquante.devise})` : 'CLAIRE';
  console.log(`  ${p.padEnd(11)} ${devises.join(',').padEnd(8)} → ${verdict}`
    + (bloquante ? `  — ${bloquante.v.raison}` : ''));
  if (Boolean(bloquante) !== attendus[p]) { incoherents++; console.log(`     ✗ attendu : ${attendus[p] ? 'bloquée' : 'claire'}`); }
}

// Cas limites du parseur
console.log('\nCas limites :');
const cas = [
  [{ date: 'Nov 12', heure: 'All Day' }, 'heure inconnue → null'],
  [{ date: 'Nov 12', heure: '12:00am' }, 'minuit'],
  [{ date: 'Nov 12', heure: '12:30pm' }, 'midi trente'],
  [{ date: 'Nov 12', heure: '8:30am' }, 'matin'],
  [{ date: 'zzz 12', heure: '8:30am' }, 'mois invalide → null']
];
for (const [e, libelle] of cas) {
  const t = F.instantEvenement(e, maintenant);
  console.log(`  ${libelle.padEnd(22)} → ${t === null ? 'null' : new Date(t).toISOString().slice(11, 16) + ' UTC'}`);
}

// Une annonce d'HIER ne doit pas bloquer aujourd'hui.
const hier = new Date(maintenant.getTime() - 24 * 3600 * 1000);
const hierEv = { date: `${['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'][hier.getUTCMonth()]} ${hier.getUTCDate()}`,
  heure: '8:30am', devise: 'USD', impact: 'high', titre: 'NFP hier' };
const vHier = F.verdictDevise([hierEv], 'USD', { maintenant, fenetreMin: 30 });
console.log(`\nAnnonce d'hier à la même heure → ${vHier.bloque ? 'BLOQUE (défaut)' : 'ne bloque pas (correct)'}`);
if (vHier.bloque) incoherents++;

console.log(`\n${incoherents === 0 ? 'COHÉRENT' : incoherents + ' INCOHÉRENCE(S)'}`);
process.exit(incoherents === 0 ? 0 : 1);
