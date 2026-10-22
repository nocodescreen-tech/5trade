/**
 * 5trade — ENTRETIEN DU JOURNAL.
 *
 * Usage :
 *   node entretien.js etat              état du livre (ouvertes par marché/TF)
 *   node entretien.js perimer           clôt ce dont la fenêtre est écoulée
 *   node entretien.js heritage          clôt l'héritage d'avant les plafonds
 *
 * POURQUOI `heritage` EXISTE
 * Avant que `risque.js` ne soit branché dans `enregistrer`, le journal acceptait
 * TOUS les signaux : 22 positions se sont retrouvées ouvertes en même temps pour
 * un plafond de 5. Avec le garde-fou actif, un livre plein bloque toute nouvelle
 * prise — parfois pendant 60 bougies d'1h, soit deux jours.
 *
 * Ces positions ne sont pas des trades d'un compte : c'est du bruit accumulé par
 * un système sans limite. Les clore en « expire » est la moins fausse des issues
 * (ce qu'elles auraient été, sans invention de gain), et cela redonne un livre
 * propre sur lequel les plafonds s'appliquent vraiment.
 *
 * Ce n'est PAS automatique : c'est une décision, donc une commande.
 */

const path = require('path');
const J = require('./journal-signaux.js');
const R = require('./risque.js');

const commande = (process.argv[2] || 'etat').toLowerCase();

function etat() {
  const signaux = J.charger().signaux;
  const ouverts = signaux.filter(s => s.resultat === 'ouvert');
  const par = {};
  for (const s of ouverts) {
    const cle = `${s.timeframe || '?'} ${s.symbol || '?'}`;
    par[cle] = (par[cle] || 0) + 1;
  }
  const cfg = R.configuration();
  const et = R.etat(signaux);
  console.log(`lignes au journal : ${signaux.length}`);
  console.log(`positions ouvertes : ${ouverts.length} (plafond ${cfg.maxSimultanes})`);
  if (ouverts.length) {
    const plusVieux = Math.min(...ouverts.map(s => s.at || Date.now()));
    console.log(`  la plus ancienne : ${((Date.now() - plusVieux) / 3600000).toFixed(1)} h`);
    for (const [k, v] of Object.entries(par).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(18)} ${v}`);
    }
  }
  console.log(`risque engagé : ${et.risqueEngage} (${et.risqueEngagePct} % du capital)`);
  console.log(`levier : ${et.levier}×`);
  const sim = R.simuler(signaux);
  console.log(`simulation : ${sim.prises}/${sim.tradesJournal} pris, `
    + `${sim.gainPct >= 0 ? '+' : ''}${sim.gainPct} %, drawdown ${sim.drawdownPct} %`);
}

if (commande === 'etat') {
  etat();
} else if (commande === 'perimer') {
  const n = J.perimer();
  console.log(`${n} position(s) périmée(s).`);
  etat();
} else if (commande === 'heritage') {
  const data = J.charger();
  const ouverts = data.signaux.filter(s => s.resultat === 'ouvert');
  if (!ouverts.length) {
    console.log('Aucune position ouverte : rien à clore.');
    process.exit(0);
  }
  const maintenant = Date.now();
  for (const s of ouverts) {
    s.resultat = 'expire';
    s.leveLe = maintenant;
    // On ne connaît PAS le prix atteint : inventer un R serait le seul vrai
    // mensonge possible ici. La ligne est conservée pour la traçabilité mais
    // exclue des statistiques (`excluHeritage`), comme des artefacts.
    s.excluHeritage = true;
    s.r = null;
  }
  J.sauver(data);
  console.log(`${ouverts.length} position(s) héritée(s) close(s) et exclue(s) des statistiques.`);
  etat();
} else if (commande === 'reinitialiser') {
  // Repartir d'un compte papier propre : la perte du jour se mesure à partir de
  // cet instant. Sans cela, le stop journalier bloque la journée entière à cause
  // de trades qui appartenaient au compte précédent.
  const data = J.charger();
  data.reinitialiseLe = Date.now();
  J.sauver(data);
  console.log(`Compte papier réinitialisé à ${new Date(data.reinitialiseLe).toISOString()}.`);
  etat();
} else {
  console.log('commande inconnue. Attendu : etat | perimer | heritage');
  process.exit(1);
}
