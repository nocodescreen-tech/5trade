#!/usr/bin/env node
/**
 * Ingestion de l'historique en base.
 *
 *   npm run ingerer                          (séries par défaut, 5 000 bougies)
 *   npm run ingerer -- --symbol BTCUSDT --tf 5m --nombre 20000
 *   npm run ingerer -- --symbol R_75 --tf 15m --nombre 10000
 *
 * Télécharge via api/sources/historique.js (Binance / Deriv / Yahoo), enregistre
 * dans la table `candles` (idempotent), puis contrôle la qualité de ce qui est
 * réellement stocké et affiche la couverture.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const DB = require('../core/db');
const Historique = require('../sources/historique');
const Candles = require('./candles');
const Qualite = require('./quality');

const PAR_DEFAUT = [
  { symbol: 'BTCUSDT', tf: '5m' },
  { symbol: 'R_75', tf: '15m' },
  { symbol: 'R_25', tf: '15m' }
];

function options() {
  const a = process.argv.slice(2);
  const lire = (nom, defaut) => {
    const i = a.indexOf('--' + nom);
    return i >= 0 && a[i + 1] ? a[i + 1] : defaut;
  };
  // npm intercepte les --drapeaux inconnus : on accepte aussi la forme
  // positionnelle « ingerer BTCUSDT 5m 5000 ».
  const libres = a.filter(x => !x.startsWith('--'));
  const symbol = lire('symbol', libres[0] || null);
  const tf = lire('tf', libres[1] || '5m');
  const nombre = Number(lire('nombre', libres[2] || '5000'));
  return {
    series: symbol ? [{ symbol, tf }] : PAR_DEFAUT,
    nombre: Number.isFinite(nombre) ? Math.max(100, Math.min(100000, nombre)) : 5000
  };
}

async function principal() {
  const { series, nombre } = options();
  await DB.init();
  if (!DB.isPg()) {
    console.log('Stockage fichiers : l\'ingestion exige PostgreSQL (npm run migrer).');
    return { ok: false };
  }
  if (!(await Candles.disponible())) {
    console.log('Table candles absente : lancez d\'abord « npm run migrer ».');
    return { ok: false };
  }

  const bilan = [];
  for (const s of series) {
    process.stdout.write(`  ${s.symbol.padEnd(10)} ${s.tf.padEnd(4)} téléchargement… `);
    let bougies = [];
    try {
      const meta = await Historique.telecharger({ symbol: s.symbol, tf: s.tf, nombre });
      // telecharger() écrit la série sur disque et rend des métadonnées :
      // on relit le fichier pour obtenir les bougies elles-mêmes.
      bougies = Historique.charger(meta.provider, s.symbol, s.tf);
    } catch (e) {
      console.log(`échec (${e.message.slice(0, 60)})`);
      bilan.push({ ...s, ok: false, raison: e.message.slice(0, 80) });
      continue;
    }
    const r = await Candles.enregistrer(s.symbol, s.tf, null, bougies);
    console.log(`${bougies.length} reçue(s), ${r.ecrites} nouvelle(s), ${r.ignorees} écartée(s)` +
      (r.ok ? '' : ` — ${r.raison}`));
    bilan.push({ ...s, ok: r.ok, recues: bougies.length, ecrites: r.ecrites, ignorees: r.ignorees });
  }

  // Contrôle sur ce qui est RÉELLEMENT en base, pas sur ce qui vient d'arriver.
  console.log('\n  couverture en base :');
  const cov = await Candles.couverture();
  for (const s of cov.series) {
    const q = Qualite.analyser(await Candles.lire(s.symbole, s.timeframe, { limite: 5000 }), { timeframe: s.timeframe, historique: true });
    console.log(`    ${s.symbole.padEnd(10)} ${s.timeframe.padEnd(4)} ${String(s.bougies).padStart(6)} bougies · ` +
      `${String(s.jours).padStart(5)} j · ${s.manquantes === null ? '?' : s.manquantes} manquante(s) · ` +
      `qualité ${q.score} ${q.ok ? '✓' : '✗ ' + q.problemes.filter(p => p.gravite === 'critique').map(p => p.type).join(',')}`);
  }
  return { ok: true, bilan };
}

module.exports = { principal };

if (require.main === module) {
  principal().then(() => process.exit(0)).catch(e => {
    console.error('ÉCHEC :', e.message);
    process.exit(1);
  });
}
