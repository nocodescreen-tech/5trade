/**
 * Les PAIRES : quelles sources marchent aujourd'hui, analyse + signal.
 * Script temporaire.
 */
const path = require('path');
const API = 'C:/Users/rene/trading-platform/api';
require(path.join(API, 'node_modules', 'dotenv')).config({ path: 'C:/Users/rene/trading-platform/.env' });
const market = require(path.join(API, 'market.js'));
const signals = require(path.join(API, 'signals.js'));

const binance = async (sym) => {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`);
    const j = await r.json();
    return j.price ? `${j.price}` : (j.msg || 'indisponible');
  } catch { return 'erreur reseau'; }
};

(async () => {
  console.log('=== Paires disponibles sur Binance (24/7) ===');
  for (const s of ['EURUSDT', 'GBPUSDT', 'AUDUSDT', 'USDJPY', 'EURGBP', 'EURUSDC']) {
    console.log(`  ${s.padEnd(9)} ${await binance(s)}`);
  }

  console.log('\n=== Analyse + signal sur les paires ===');
  const essais = [
    ['EURUSDT', '5m', 'binance'],
    ['GBPUSDT', '5m', 'binance'],
    ['EURUSDT', '15m', 'binance'],
    ['frxEURUSD', '5m', 'deriv'],
    ['frxGBPUSD', '5m', 'deriv']
  ];
  for (const [sym, tf, prov] of essais) {
    try {
      const r = await market.getCandles(sym, tf, 300, prov);
      const closed = r.candles.filter(c => c.closed !== false);
      const last = closed[closed.length - 1];
      let verdict = 'analyse impossible';
      try {
        const v = signals.detect(closed, { symbol: sym, timeframe: tf });
        verdict = `${v.status}/${v.direction} force ${(v.strength * 100).toFixed(0)}%`;
      } catch (e) { verdict = 'echec: ' + e.message.slice(0, 40); }
      console.log(`  ${sym.padEnd(11)}${tf.padEnd(5)}${prov.padEnd(8)} ${String(closed.length).padStart(3)} bougies | close ${last ? last.c : '?'} | ${verdict}`);
    } catch (e) {
      console.log(`  ${sym.padEnd(11)}${tf.padEnd(5)}${prov.padEnd(8)} ECHEC : ${e.message.slice(0, 70)}`);
    }
  }

  console.log('\n=== Message d\'erreur actuel quand un marche est ferme ===');
  try {
    await market.getCandles('frxGBPUSD', '5m', 300, 'deriv');
    console.log('  (aucune erreur)');
  } catch (e) {
    console.log('  ->', e.message);
  }

  market.closeStream();
  process.exit(0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(1); });
