#!/usr/bin/env node
/**
 * Redondance des règles — mesurer si R1..R4 observent des choses différentes.
 *
 *   npm run redondance -- --symbol R_75 --tf 15m
 *   npm run redondance -- --symbol BTCUSDT --tf 5m --pas 40
 *
 * Pourquoi : durcir une stratégie en exigeant « toutes les conditions » ne sert à
 * rien si ces conditions regardent la même chose. On mesure donc, sur l'historique,
 * à quelle fréquence chaque règle s'active et à quel point les paires s'activent
 * ENSEMBLE (coefficient phi sur variables binaires, plus le taux de co-activation).
 *
 * Une paire avec |phi| > 0.7 est redondante : la seconde règle n'ajoute presque
 * aucune information, elle ne fait que durcir la première.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const DB = require('../core/db');
const Candles = require('./candles');
const Signals = require('../engine/signals');

const REGLES = ['R1', 'R2', 'R3', 'R4'];

function options() {
  const a = process.argv.slice(2);
  const lire = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
  const libres = a.filter(x => !x.startsWith('--'));
  const pas = Number(lire('pas', '20'));
  const fenetre = Number(lire('fenetre', '5000'));
  return {
    symbol: lire('symbol', libres[0] || 'R_75'),
    tf: lire('tf', libres[1] || '15m'),
    pas: Number.isFinite(pas) && pas > 0 ? pas : 20,
    fenetre: Number.isFinite(fenetre) ? fenetre : 5000
  };
}

/** Coefficient phi (Matthews) entre deux variables binaires. */
function phi(a, b) {
  const n = a.length;
  let n11 = 0, n10 = 0, n01 = 0, n00 = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] && b[i]) n11++;
    else if (a[i] && !b[i]) n10++;
    else if (!a[i] && b[i]) n01++;
    else n00++;
  }
  const num = n11 * n00 - n10 * n01;
  const den = Math.sqrt((n11 + n10) * (n01 + n00) * (n11 + n01) * (n10 + n00));
  return den === 0 ? 0 : +(num / den).toFixed(3);
}

async function principal() {
  const { symbol, tf, pas, fenetre } = options();
  await DB.init();
  if (!DB.isPg()) { console.log('PostgreSQL requis.'); return; }

  let serie = await Candles.lire(symbol, tf, { limite: 50000 });
  if (!serie.length) { console.log(`Aucune bougie pour ${symbol} ${tf}.`); return; }
  if (serie.length > fenetre) serie = serie.slice(-fenetre);

  const moteur = { regles: REGLES, seuilRegles: 1, seuilForce: 0 };
  const votes = { R1: [], R2: [], R3: [], R4: [] };
  let fenetres = 0, toutes = 0, aucune = 0;

  for (let i = 120; i < serie.length; i += pas) {
    const fen = serie.slice(Math.max(0, i - 300), i + 1);
    let v;
    try { v = Signals.detect(fen, { timeframe: tf }, { moteur }); } catch { continue; }
    if (!v || !v.direction) continue;
    fenetres++;
    // « active » = la règle a un avis, dans un sens ou dans l'autre : la redondance
    // porte sur l'OBSERVATION, pas sur la direction.
    const actives = new Set([...(v.reglesPour || []), ...(v.reglesContre || [])]);
    for (const r of REGLES) votes[r].push(actives.has(r));
    if (REGLES.every(r => actives.has(r))) toutes++;
    if (REGLES.every(r => !actives.has(r))) aucune++;
  }

  if (!fenetres) { console.log('Aucune fenêtre évaluable.'); return; }

  console.log(`  ${symbol} ${tf} · ${fenetres} fenêtres évaluées (pas ${pas})\n`);
  console.log('  fréquence d\'activation :');
  for (const r of REGLES) {
    const n = votes[r].filter(Boolean).length;
    console.log(`    ${r} · ${Signals.REGLES_INFO[r] || ''}`.padEnd(46) +
      `${String(n).padStart(5)} / ${fenetres}  ${(n / fenetres * 100).toFixed(1)} %`);
  }
  console.log(`\n    les 4 ensemble : ${toutes} (${(toutes / fenetres * 100).toFixed(1)} %)` +
    ` · aucune : ${aucune} (${(aucune / fenetres * 100).toFixed(1)} %)`);

  const paires = [];
  for (let i = 0; i < REGLES.length; i++) {
    for (let j = i + 1; j < REGLES.length; j++) {
      const a = votes[REGLES[i]], b = votes[REGLES[j]];
      const co = a.filter((x, k) => x && b[k]).length;
      const union = a.filter((x, k) => x || b[k]).length;
      paires.push({
        paire: `${REGLES[i]}/${REGLES[j]}`,
        phi: phi(a, b),
        jaccard: union ? +(co / union).toFixed(3) : 0,
        co: union ? co : 0
      });
    }
  }
  paires.sort((x, y) => Math.abs(y.phi) - Math.abs(x.phi));

  console.log('\n  redondance des paires (phi, Jaccard) :');
  for (const p of paires) {
    const verdict = Math.abs(p.phi) >= 0.7 ? 'REDONDANT'
      : Math.abs(p.phi) >= 0.4 ? 'proche' : 'indépendant';
    console.log(`    ${p.paire.padEnd(8)} phi ${String(p.phi).padStart(6)} · ` +
      `Jaccard ${String(p.jaccard).padStart(5)} · ${p.co} co-activation(s) · ${verdict}`);
  }

  const redondantes = paires.filter(p => Math.abs(p.phi) >= 0.7).map(p => p.paire);
  console.log(`\n  conclusion : ${redondantes.length
    ? `${redondantes.length} paire(s) redondante(s) — ${redondantes.join(', ')}`
    : 'aucune paire franchement redondante'}`);
  console.log('  Une condition redondante ne renforce pas une stratégie : elle la durcit sans rien prouver.');
}

module.exports = { principal, phi };

if (require.main === module) {
  principal().then(() => process.exit(0)).catch(e => {
    console.error('ÉCHEC :', e.message);
    process.exit(1);
  });
}
