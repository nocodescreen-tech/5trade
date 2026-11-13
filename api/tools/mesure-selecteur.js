// Mesure du sélecteur : quelles fiches sont retenues, lesquelles écartées et pourquoi.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const M = require('../sources/market');
const Sel = require('../strategy-engine/selector');

const dossier = path.join(__dirname, '..', '..', 'knowledge-base');
const strategies = fs.readdirSync(dossier)
  .filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8')))
  .filter(d => d.type === 'strategy');

(async () => {
  for (const [symbol, tf] of [['frxEURUSD', '15m'], ['R_75', '15m']]) {
    const { candles } = await M.getCandles(symbol, tf, 300);
    const r = Sel.selectionner({ candles, meta: { symbol, timeframe: tf }, strategies });
    console.log(`\n=== ${symbol} ${tf} — ${r.motif}`);
    console.log(`    compatibilité : ${JSON.stringify(r.compatibilite)}`);
    for (const c of r.candidates) {
      const etat = c.retenue ? 'RETENUE' : (c.compatible ? 'écartée' : 'écartée ');
      console.log(`  ${etat} ${String(c.id).padEnd(24)} statut=${String(c.statut || '—').padEnd(10)}`
        + ` score=${String(c.score).padEnd(6)} règles=${(c.regles || []).join('+') || '—'}`);
      if (c.motif) console.log(`            ${c.motif}`);
    }
  }
  process.exit(0);
})().catch(e => { console.log('ERREUR:', e.message.slice(0, 160)); process.exit(1); });
