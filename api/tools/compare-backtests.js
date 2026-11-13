/**
 * COMPARAISON des deux backtests, sur la MÊME série.
 *
 * C'est la mesure que les audits demandent avant de retirer quoi que ce soit :
 * combien de trades l'ancien chemin compte-t-il en plus de ce que le moteur
 * publie réellement, et quel écart cela fait-il sur l'espérance affichée.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const M = require('../sources/market');
const B = require('../engine/backtest');

(async () => {
  const symbol = process.argv[2] || 'R_75';
  const tf = process.argv[3] || '15m';
  const { candles } = await M.getCandles(symbol, tf, 700);
  const serie = candles.filter(c => c.closed !== false);
  console.log(`\n=== ${symbol} ${tf} — ${serie.length} bougies clôturées`);

  // 1. Ancien chemin : détecteur + simulation.
  let ancien = null;
  try {
    ancien = B.lancer(serie, { symbol, timeframe: tf, limiteTrades: 5000 },
      { pas: 6, largeur: 250, profil: null });
  } catch (e) { console.log('ancien backtest : erreur —', e.message.slice(0, 90)); }

  // 2. Chemin fidèle : DecisionEngine.decider à chaque pas.
  const t0 = Date.now();
  const fidele = B.lancerFidele(serie, { symbol, timeframe: tf },
    { pas: 6, fenetre: 250, maxEtapes: 60, decision: { exigerAlignement: false } });
  const ms = Date.now() - t0;

  const lire = (o, k) => (o && Number.isFinite(o[k]) ? o[k] : null);
  const nbAncien = ancien ? (ancien.trades || []).length : null;
  const rAncien = ancien ? (ancien.rTotal !== undefined ? ancien.rTotal : lire(ancien, 'rTotal')) : null;

  console.log('\nancien chemin (Multi.detecterTout + simulation)');
  console.log('  trades :', nbAncien, '| R total :', rAncien,
    '| espérance :', ancien ? ancien.esperance : '—');
  console.log('\nchemin fidèle (DecisionEngine.decider)');
  console.log('  trades :', fidele.stats.n, '| R net :', fidele.stats.rNet,
    '| espérance nette :', fidele.stats.esperanceNette,
    '| étapes :', fidele.etapes, `| ${ms} ms`);

  if (nbAncien && fidele.stats.n) {
    console.log('\nrapport :', (nbAncien / Math.max(1, fidele.stats.n)).toFixed(1), 'x plus de trades dans l’ancien chemin');
  }
  console.log('\nfrais renseignés :', fidele.stats.fraisRenseignes, '/', fidele.stats.avecR);
  process.exit(0);
})().catch(e => { console.log('ERREUR:', e.message.slice(0, 160)); process.exit(1); });
