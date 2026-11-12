// Mesure du moteur par classe sur de vraies séries.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const M = require('../sources/market');
const Mo = require('../moteurs');
const { classifier } = require('../market-intelligence/instrument-classifier');

const CAS = [
  ['R_75', 'deriv'], ['BOOM1000', 'deriv'], ['CRASH1000', 'deriv'],
  ['frxEURUSD', 'deriv'], ['frxXAUUSD', 'deriv'], ['BTCUSDT', 'binance']
];

(async () => {
  for (const [sym, prov] of CAS) {
    try {
      const r = await M.getCandles(sym, '5m', 300, prov);
      const closes = (r.candles || []).filter(c => c.closed !== false).map(c => c.c);
      const cl = classifier(sym, { provider: prov }).classe;
      const d = Mo.analyser(cl, closes, { symbol: sym, classe: cl, timeframe: '5m' });
      if (!d) {
        console.log(String(sym).padEnd(11), cl.padEnd(12), '→ aucun moteur dédié (le dit)');
        continue;
      }
      console.log(String(sym).padEnd(11), cl.padEnd(12),
        '| convient:', String(d.convient).padEnd(5),
        '| régime:', String(d.regime).padEnd(6),
        '| refus:', (d.refus || []).join(' · ') || '—');
      (d.faits || []).forEach(f => console.log('             ·', f));
    } catch (e) {
      console.log(String(sym).padEnd(11), 'ERREUR', e.message);
    }
  }
  process.exit(0);
})();
