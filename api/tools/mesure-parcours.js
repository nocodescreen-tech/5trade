// Mesure du parcours du prix sur des données réelles : combien de zones sont
// encore valables, combien sont mortes, et pourquoi.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const M = require('../sources/market');
const P = require('../engine/parcours-prix');
const Str = require('../engine/structure');

(async () => {
  for (const [sym, tf] of [['R_75', '15m'], ['frxEURUSD', '15m']]) {
    const { candles } = await M.getCandles(sym, tf, 300);
    // Le rapport de structure est celui du moteur, pas un calcul parallèle.
    let report = null;
    try { report = Str.analyze(candles); } catch (e) { console.log('structure KO:', e.message.slice(0,60)); report = null; }
    const zones = report ? P.suivreZones(report, candles, {}) : { zones: [], resume: {}, total: 0 };
    console.log(`\n=== ${sym} ${tf} — ${zones.total} zone(s)`);
    console.log('   ', JSON.stringify(zones.resume));
    for (const z of zones.zones.slice(0, 6)) {
      console.log(`  ${String(z.etat).padEnd(13)} ${String(z.origine).padEnd(11)} ${String(z.low).padStart(10)}–${String(z.high).padEnd(10)} | ${(z.preuves[0] || '').slice(0, 62)}`);
    }
  }
  process.exit(0);
})().catch(e => { console.log('ERREUR:', e.message.slice(0, 140)); process.exit(1); });
