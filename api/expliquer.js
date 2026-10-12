const fs = require('fs'), path = require('path');
const env = path.join(__dirname, '..', '.env');
if (fs.existsSync(env)) for (const l of fs.readFileSync(env, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const S = require('./structure.js'), Sig = require('./signals.js'), M = require('./market.js');
const L = () => '─'.repeat(72);

(async () => {
  const symbol = process.argv[2] || 'R_75', tf = process.argv[3] || '5m';
  console.log('\n' + L());
  console.log('DEROULE COMPLET D UNE ANALYSE  —  ' + symbol + ' en ' + tf);
  console.log(L());

  // 1
  const { candles, provider } = await M.getCandles(symbol, tf, 300, 'deriv');
  const closes = candles.filter(c => c.closed !== false);
  const der = closes[closes.length - 1];
  console.log('\n[1] LES DONNEES BRUTES');
  console.log('    ' + candles.length + ' bougies recues de "' + provider + '", dont ' + closes.length + ' CLOTUREES');
  console.log('    la derniere bougie cloturee : ouverture ' + der.o + '  ->  cloture ' + der.c);
  console.log('    (on ne travaille que sur des bougies finies : une bougie en cours change encore)');

  // 2
  const rep = S.analyze(closes, { symbol, timeframe: tf });
  const ev = rep.structure.event;
  console.log('\n[2] LES MESURES  —  structure.analyze() : on mesure, on ne devine pas');
  console.log('    tendance generale   : ' + rep.structure.trend);
  console.log('    dernier evenement   : ' + (ev ? ev.type + ' ' + ev.direction + ' a ' + ev.level : 'aucun'));
  console.log('    order blocks (OB)   : ' + rep.orderBlocks.length);
  console.log('    desequilibres (FVG) : ' + rep.fvgs.length);
  console.log('    amas de liquidite   : ' + rep.liquidity.length);
  console.log('    balayages (sweeps)  : ' + rep.sweeps.length);
  console.log('    position dans range : ' + rep.premiumDiscount.position
    + '  (equilibre ' + rep.premiumDiscount.equilibrium + ')');
  console.log('    amplitude (ATR 14)  : ' + rep.atr14.toFixed(2));
  console.log('    => ' + (rep.inventory && rep.inventory.total ? rep.inventory.total : '?') + ' elements identifies au total');

  // 3
  const v = Sig.detect(closes, { symbol, timeframe: tf });
  console.log('\n[3] LES 4 REGLES  —  chacune repond OUI ou NON, avec une force');
  console.log('    R1 balayage de liquidite      : ' + (v.rules.some(r => r.rule === 'R1') ? 'OUI' : 'non'));
  console.log('    R2 rupture de structure       : ' + (v.rules.some(r => r.rule === 'R2') ? 'OUI' : 'non'));
  console.log('    R3 zone reactive (OB / FVG)   : ' + (v.rules.some(r => r.rule === 'R3') ? 'OUI' : 'non'));
  console.log('    R4 position premium/discount  : ' + (v.rules.some(r => r.rule === 'R4') ? 'OUI' : 'non'));
  for (const r of (v.rules || [])) {
    console.log('      -> ' + r.rule + ' : ' + r.name + '  =>  ' + r.direction + '   force ' + (r.strength * 100).toFixed(0) + ' %');
  }
  console.log('    total : ' + (v.rules || []).length + ' regle(s) sur 4');

  // 4
  console.log('\n[4] LE VERDICT  —  la regle est simple et toujours la meme');
  console.log('    CONFIRME     si au moins 2 regles concordent ET force >= 35 %');
  console.log('    A SURVEILLER si au moins 1 regle et force >= 30 %');
  console.log('    NEUTRE       sinon');
  console.log('    ------------------------------------------------');
  console.log('    resultat : ' + v.status.toUpperCase() + '  ' + v.direction + '   force ' + (v.strength * 100).toFixed(0) + ' %');
  console.log('    tendance : ' + v.trend);
  console.log('    resume   : ' + v.summary);
  if (v.missing && v.missing.length) console.log('    il manque : ' + v.missing.join(' ; '));

  // 5
  console.log('\n[5] LES NIVEAUX  —  calcules a partir de la structure et de l ATR');
  if (v.levels) {
    const p = v.levels;
    console.log('    entree       : ' + p.entry);
    console.log('    invalidation : ' + p.stop + '   (distance ' + Math.abs(p.entry - p.stop).toFixed(2) + ')');
    console.log('    objectif 1   : ' + p.target1);
    console.log('    objectif 2   : ' + p.target2);
    const rr = Math.abs(p.target1 - p.entry) / Math.max(0.0001, Math.abs(p.entry - p.stop));
    console.log('    rapport gain/risque sur objectif 1 : ' + rr.toFixed(2) + ' pour 1');
  } else console.log('    aucun niveau : le verdict est neutre, donc rien a proposer');

  // 6
  console.log('\n[6] LES DEUX SCENARIOS  —  toujours les deux, pour ne jamais etre pris a revers');
  const sc = v.scenarios || {};
  if (sc.biais) console.log('    biais du marche : ' + sc.biais + '   (' + (sc.raisonBiais || '') + ')');
  for (const s of [sc.bullish, sc.bearish].filter(Boolean)) {
    console.log('    ' + s.direction + '  [' + (s.priorite || '') + ']');
    console.log('        declencheur : ' + (s.trigger || ''));
    if (s.context) console.log('        contexte    : ' + s.context);
    if (s.entry !== undefined) console.log('        entree ' + s.entry + ' / invalidation ' + s.stop
      + ' / objectifs ' + s.target1 + ' puis ' + s.target2);
    if (s.objectifProche) console.log('        cible la plus proche : ' + s.objectifProche);
  }

  // 7
  const tfs = Sig.TF_SUPERIEURS[tf] || [tf];
  const parTF = [];
  for (const t of tfs) {
    const r = await M.getCandles(symbol, t, 300, 'deriv');
    parTF.push({ tf: t, verdict: Sig.detect(r.candles.filter(c => c.closed !== false), { symbol, timeframe: t }) });
  }
  const conf = Sig.confluence(parTF);
  console.log('\n[7] ALIGNEMENT DES UNITES DE TEMPS  —  le "tir de sniper"');
  console.log('    unites examinees : ' + tfs.join(', ') + '   |   il en faut ' + conf.seuilAlignes + ' d accord');
  for (const d of conf.detail) {
    console.log('    ' + d.tf.padEnd(4) + d.tendance.padEnd(9) + d.status.padEnd(12) + (d.direction || '')
      + (d.regles && d.regles.length ? '  [' + d.regles.join('+') + ']' : ''));
  }
  console.log('    => aligne : ' + (conf.aligne ? 'OUI' : 'NON') + '   (' + conf.motif + ')');

  // 8
  const fin = Sig.verdictAvecConfluence(parTF, { seuilAlignes: conf.seuilAlignes });
  console.log('\n[8] CE QUI PARTIRAIT PAR EMAIL');
  console.log('    statut avant alignement : ' + v.status);
  console.log('    statut apres alignement : ' + fin.verdict.status
    + (fin.verdict.alignementManquant ? '   (degrade : le contexte ne suit pas)' : ''));
  console.log('    => ' + (fin.verdict.status === 'confirme'
    ? 'OUI, un email part — une seule fois par signal'
    : 'NON : rien ne part, tu n es pas derange pour du bruit'));
  console.log('\n' + L() + '\n');
  M.closeStream(); process.exit(0);
})().catch(e => { console.log('ERREUR:', e.message); process.exit(1); });
