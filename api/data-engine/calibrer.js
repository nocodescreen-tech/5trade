#!/usr/bin/env node
/**
 * Calibration d'une stratégie sur l'historique réellement stocké.
 *
 *   npm run calibrer -- --symbol BTCUSDT --tf 5m
 *   npm run calibrer -- --symbol R_75 --tf 15m --grille fine
 *
 * Méthode, volontairement austère :
 *  1. découpe CHRONOLOGIQUE : 70 % entraînement, 30 % validation (jamais mélangés) ;
 *  2. grille de seuils (force × nombre de règles) sur l'entraînement ;
 *  3. le meilleur réglage est REJOUÉ sur la validation, sans y retoucher ;
 *  4. si la validation ne tient pas (espérance ≤ 0, ou trop peu de trades),
 *     le réglage est REFUSÉ — c'est le cas normal, pas une anomalie.
 *
 * Rien n'est écrit dans la configuration : ce script mesure et imprime. Appliquer
 * un réglage reste une décision humaine, versionnée dans le registre.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const DB = require('../core/db');
const Candles = require('./candles');
const Backtest = require('../engine/backtest');
const Performance = require('../engine/performance');

function options() {
  const a = process.argv.slice(2);
  const lire = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
  const libres = a.filter(x => !x.startsWith('--'));
  const symbol = lire('symbol', libres[0] || 'BTCUSDT');
  const tf = lire('tf', libres[1] || '5m');
  const grille = lire('grille', 'normale');
  const forces = grille === 'fine'
    ? [0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]
    : [0.50, 0.60, 0.70];
  const regles = grille === 'fine' ? [2, 3, 4] : [2, 3];
  // Fenêtre de calcul : le backtest coûte ~10 ms par bougie. 6 000 bougies =
  // environ 4 minutes pour une grille normale ; au-delà, on découpe davantage
  // sans gagner en nombre de trades (le moteur plafonne à 200 par passe).
  const fenetre = Number(lire('fenetre', '6000'));
  return { symbol, tf, forces, regles, fenetre: Number.isFinite(fenetre) ? fenetre : 6000 };
}

const profil = (force, seuilRegles) => ({
  id: 'calibration', titre: 'calibration',
  regles: ['R1', 'R2', 'R3', 'R4'],
  seuilForce: force, seuilRegles,
  parametres: { atrStop: 1 }
});

async function principal() {
  const { symbol, tf, forces, regles, fenetre } = options();
  await DB.init();
  if (!DB.isPg()) { console.log('PostgreSQL requis (npm run migrer).'); return; }
  let serie = await Candles.lire(symbol, tf, { limite: 50000 });
  if (serie.length > fenetre) serie = serie.slice(-fenetre);
  if (serie.length < 500) {
    console.log(`Historique insuffisant : ${serie.length} bougies. Lancez « npm run ingerer -- ${symbol} ${tf} 20000 ».`);
    return;
  }

  const coupe = Math.floor(serie.length * 0.7);
  const entrainement = serie.slice(0, coupe);
  const validation = serie.slice(coupe);
  console.log(`  ${symbol} ${tf} : ${serie.length} bougies — ` +
    `${entrainement.length} entraînement / ${validation.length} validation\n`);

  const mesurer = (bougies, force, seuilRegles) => {
    const r = Backtest.lancer(bougies,
      { symbol, timeframe: tf },
      { profils: [profil(force, seuilRegles)], pas: 2, maxBougies: 20000, plafond: 20000 });
    if (r.indisponible) return { indisponible: true, raison: r.raison };
    const clos = (r.trades || []).filter(t => Number.isFinite(Number(t.r)));
    return { ...Performance.metriques(clos), trades: clos.length };
  };

  const resultats = [];
  for (const f of forces) {
    for (const s of regles) {
      const m = mesurer(entrainement, f, s);
      if (m.indisponible) continue;
      resultats.push({ force: f, seuilRegles: s, ...m });
    }
  }
  resultats.sort((a, b) => (b.expectancyR || -9) - (a.expectancyR || -9));

  console.log('  entraînement (70 %) — trié par espérance :');
  console.log('    force  règles   n     PF     espérance   taux');
  for (const r of resultats) {
    console.log(`    ${String(r.force).padEnd(6)} ${String(r.seuilRegles).padEnd(8)} ` +
      `${String(r.trades).padStart(4)}  ${String(r.profitFactor).padEnd(6)} ` +
      `${(r.expectancyR >= 0 ? '+' : '') + r.expectancyR}       ${r.winRate ?? '—'} %`);
  }

  const meilleur = resultats[0];
  if (!meilleur) { console.log('\n  aucun réglage exploitable.'); return; }

  console.log(`\n  meilleur réglage : force ${meilleur.force}, ${meilleur.seuilRegles} règle(s)`);
  const oos = mesurer(validation, meilleur.force, meilleur.seuilRegles);
  if (oos.indisponible) { console.log(`  validation impossible : ${oos.raison}`); return; }

  console.log(`  validation (30 %, jamais vue) : n=${oos.trades} · PF ${oos.profitFactor} · ` +
    `espérance ${oos.expectancyR >= 0 ? '+' : ''}${oos.expectancyR} R · taux ${oos.winRate ?? '—'} % · ` +
    `drawdown ${oos.maxDrawdownR} R`);

  // Verdict sur les DEUX périodes déjà mesurées : recalculer une découpe ici
  // produisait un verdict qui contredisait les chiffres affichés juste au-dessus.
  const verdict = Performance.verdictDepuisMetriques(meilleur, oos);
  console.log(`\n  verdict : ${verdict.fiable ? 'tenable hors échantillon' : 'NON retenu'}` +
    (verdict.raisons.length ? ` — ${verdict.raisons.join(' ; ')}` : ''));
  console.log('  Rappel : une calibration tenable n\'est pas une garantie de gain futur.');
}

module.exports = { principal };

if (require.main === module) {
  principal().then(() => process.exit(0)).catch(e => {
    console.error('ÉCHEC :', e.message);
    process.exit(1);
  });
}
