/**
 * Les ATR du dépôt donnent-ils le même nombre sur la même série ?
 *
 * Si trois modules calculent trois ATR différents, alors les stops, les tailles
 * de position et les seuils de volatilité ne parlent pas du même marché — et
 * tous les tests passent quand même, parce qu'aucun ne compare les trois.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const M = require('../sources/market');
const Plans = require('../engine/plans');
const Structure = require('../engine/structure');
const Signals = require('../engine/signals');

(async () => {
  for (const [sym, tf] of [['R_75', '15m'], ['frxEURUSD', '15m'], ['frxXAUUSD', '15m']]) {
    let candles = [];
    try { ({ candles } = await M.getCandles(sym, tf, 300)); } catch (e) {
      console.log(`${sym} : données indisponibles (${e.message.slice(0, 40)})`); continue;
    }
    const serie = candles.filter(c => c.closed !== false);
    if (serie.length < 60) { console.log(`${sym} : série trop courte`); continue; }

    const valeurs = {};
    try { valeurs.plans = Plans.atr ? Plans.atr(serie, 14) : null; } catch { }
    try {
      const r = Structure.analyze(serie);
      valeurs.structure = r && (r.atr14 || r.atr);
    } catch { }
    try {
      const v = Signals.detect(serie, { symbol: sym, timeframe: tf });
      valeurs.signals = v && (v.atr || (v.context && v.context.atr14));
    } catch { }

    // ATR « classique » recalculé ici, comme référence indépendante.
    const trs = [];
    for (let i = 1; i < serie.length; i++) {
      const c = serie[i], p = serie[i - 1];
      trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
    }
    const ref = trs.slice(-14).reduce((a, b) => a + b, 0) / 14;

    const arrondi = v => (Number.isFinite(v) ? +Number(v).toFixed(4) : null);
    const vals = Object.fromEntries(Object.entries(valeurs).map(([k, v]) => [k, arrondi(v)]));
    const presents = Object.values(vals).filter(Number.isFinite);
    const min = Math.min(...presents), max = Math.max(...presents);
    const ecart = presents.length > 1 && min > 0 ? +(((max - min) / min) * 100).toFixed(1) : null;

    console.log(`\n${sym} ${tf} — ATR(14)`);
    console.log('  plans.js      :', vals.plans);
    console.log('  structure.js  :', vals.structure);
    console.log('  signals.js    :', vals.signals);
    console.log('  référence     :', arrondi(ref));
    console.log('  écart max     :', ecart === null ? '—' : `${ecart} %`);
  }
  process.exit(0);
})().catch(e => { console.log('ERREUR:', e.message.slice(0, 160)); process.exit(1); });
