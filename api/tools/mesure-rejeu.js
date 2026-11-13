/**
 * Mesure du rejeu fidèle : combien de trades le MOTEUR aurait publiés, et
 * lesquels le backtest approximatif comptait en plus.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const M = require('../sources/market');
const R = require('../engine/rejeu-direct');
const Multi = require('../engine/signaux');

(async () => {
  const symbol = process.argv[2] || 'R_75';
  const tf = process.argv[3] || '15m';
  const { candles } = await M.getCandles(symbol, tf, 700);
  const serie = candles.filter(c => c.closed !== false);

  const t0 = Date.now();
  const rejeu = R.rejouer(serie, { symbol, timeframe: tf }, {}, {
    fenetre: 250, pas: 6, maxEtapes: 60,
    optionsDecision: { exigerAlignement: false }
  });
  const ms = Date.now() - t0;

  console.log(`\n=== ${symbol} ${tf} — ${serie.length} bougies`);
  console.log('rejeu direct :', JSON.stringify(rejeu.stats));
  console.log(`durée : ${ms} ms · ${rejeu.etapes.length} pas`);
  for (const t of rejeu.trades.slice(0, 5)) {
    console.log(`  ${new Date(t.at).toISOString().slice(5, 16)} ${String(t.sens).padEnd(5)} `
      + `${t.entree} → ${t.resultat} · brut ${t.rBrut} R · net ${t.rNet} R · ${t.bougiesSuivies} bougies`);
  }

  // Ce que l'ancien backtest comptait : tous les signaux détectés, sans la
  // chaîne de décision. L'écart entre les deux nombres est le sur-comptage.
  let detectes = 0;
  for (let k = 250; k < serie.length; k += 6) {
    const fen = serie.slice(k - 249, k + 1);
    try {
      const r = Multi.detecterTout(fen, { symbol, timeframe: tf });
      const liste = Array.isArray(r) ? r : (r && (r.signaux || r.tous || r.liste)) || [];
      detectes += liste.length;
    } catch { }
  }
  console.log(`\nsignaux bruts détectés par Multi (sans décision) : ${detectes}`);
  console.log(`trades retenus par le moteur                     : ${rejeu.stats.n}`);
  console.log(`ratio : ${detectes ? (detectes / Math.max(1, rejeu.stats.n)).toFixed(1) : '—'}x de sur-comptage`);
  process.exit(0);
})().catch(e => { console.log('ERREUR:', e.message.slice(0, 160)); process.exit(1); });
