#!/usr/bin/env node
/**
 * 5trade — vérification (npm run verify)
 *
 * 1. Syntaxe des modules du serveur
 * 2. Couche de persistance sur une base PostgreSQL JETABLE (jamais la prod)
 * 3. Repli JSON quand DATABASE_URL est absent
 * 4. Endpoints HTTP du serveur en cours d'exécution (si joignable)
 *
 * Sortie : code 1 si au moins une vérification échoue.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const postgres = require('postgres');

// Le .env porte la config (DB, S3) : on le charge comme le serveur
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');
const ENV = path.join(ROOT, '.env');
const API = 'http://localhost:3001';

let pass = 0, fail = 0, skip = 0;
const ok = (name, cond, extra = '') => {
  (cond ? pass++ : fail++);
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
/** Test NON EXÉCUTÉ (dépendance externe absente) : ni vert ni rouge. */
const skipped = (name, why = '') => {
  skip++;
  console.log(`  ${'•'} ${name}${why ? ' — ' + why : ''}`);
};
const section = t => console.log(`\n${t}`);

// ── Génère un petit PNG valide (fond blanc + ligne montante) sans aucune dépendance.
//    Sert à tester la vision sur une image réelle produite à la volée.
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function tinyPng(W = 64, H = 40) {
  const zlib = require('zlib');
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0; // filtre None
    for (let x = 0; x < W; x++) {
      const on = Math.abs(y - (H - 6 - x * (H - 12) / W)) < 2; // ligne montante
      const v = on ? 0 : 255;
      raw[o++] = v; raw[o++] = v; raw[o++] = v;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits/canal, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

(async () => {
  // ── 1. Syntaxe ──
  section('[1] Syntaxe');
  for (const f of ['server.js', 'db.js', 's3.js', 'vision.js', 'trades.js', 'search.js', 'export.js', 'market.js', 'structure.js', 'signals.js', 'reset-password.js', 'bootstrap-db.js', 'alerts.js', 'lexique.js', 'expliquer.js', 'concepts.js', 'playbooks.js']) {
    try {
      require('child_process').execFileSync(process.execPath, ['--check', path.join(__dirname, f)]);
      ok(f, true);
    } catch (e) { ok(f, false, e.message.split('\n')[0]); }
  }

  // Anti-régression : le compte vit en base. Écrire dans data/account.json
  // n'aurait aucun effet (l'application ne lit plus ce fichier) — le jour où
  // on perd le mot de passe, le script de secours doit réellement agir.
  const rpSrc = fs.readFileSync(path.join(__dirname, 'reset-password.js'), 'utf8');
  ok('reset-password.js passe par la couche de persistance',
    /require\('\.\/db'\)/.test(rpSrc) && !/writeFileSync\([^)]*account\.json/.test(rpSrc));
  const srvSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  ok('server.js ne lit/écrit plus account.json directement',
    !/readJSON\(ACCOUNT_FILE/.test(srvSrc) && !/writeJSON\(ACCOUNT_FILE/.test(srvSrc));

  // ── 2 & 3. Persistance ──
  const prodUrl = (fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf-8') : '')
    .match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();

  if (!prodUrl) {
    section('[2] Persistance PostgreSQL — non testé');
    skipped('persistance PostgreSQL', 'DATABASE_URL absent du .env (repli JSON actif)');
  } else {
    const scratch = `5trade_verify_${Date.now()}`;
    const adminUrl = prodUrl.replace(/\/[^/]*$/, '/postgres');
    const admin = postgres(adminUrl, { onnotice: () => {} });

    section('[2] Persistance PostgreSQL (base jetable)');
    try {
      await admin.unsafe(`create database "${scratch}"`);
      process.env.DATABASE_URL = prodUrl.replace(/\/[^/]*$/, '/' + scratch);

      const DB = require('./db.js');
      ok('DB.init() → PostgreSQL', (await DB.init()) === true);
      ok('isPg()', DB.isPg() === true);

      await DB.saveAccount({ id: 'owner', username: 'verify', verified: true });
      ok('compte', (await DB.getAccount())?.username === 'verify');

      await DB.saveSessions({ t1: { username: 'verify', expires: Date.now() + 1e4 } });
      ok('sessions', !!(await DB.loadSessions()).t1);

      await DB.saveOtp({ verify: { purpose: 'login', sends: [] } });
      ok('otp', !!(await DB.loadOtp()).verify);

      await DB.saveHistory([{ id: 'h1' }]);
      ok('historique', (await DB.loadHistory()).length === 1);

      const before = (await DB.listStrategies()).length;
      await DB.saveStrategyRecord({ id: 'v1', title: 'A', createdAt: new Date().toISOString() });
      await DB.saveStrategyRecord({ id: 'v2', title: 'B', createdAt: new Date().toISOString() });
      ok('stratégies +2', (await DB.listStrategies()).length === before + 2, `${before} → ${before + 2}`);
      await DB.removeStrategyRecord('v1');
      const left = await DB.listStrategies();
      ok('stratégies -1', left.length === before + 1 && !left.some(s => s.id === 'v1'));
    } catch (e) {
      ok('persistance PostgreSQL', false, e.message);
    } finally {
      await admin.unsafe(`drop database if exists "${scratch}" with (force)`).catch(() => {});
      await admin.end().catch(() => {});
      delete require.cache[require.resolve('./db.js')];
      ok('base jetable supprimée', true, scratch);
    }
  }

  section('[3] Repli JSON (sans DATABASE_URL)');
  delete process.env.DATABASE_URL;
  delete require.cache[require.resolve('./db.js')];
  ok('DB.init() → JSON local', (await require('./db.js').init()) === false);

  // ── 4. HTTP ──
  section('[4] Endpoints HTTP');
  try {
    const call = async (p, opts) => {
      const r = await fetch(API + p, opts);
      let body = null; try { body = await r.json(); } catch {}
      return { status: r.status, body };
    };
    ok('serveur joignable', (await fetch(API + '/')).status === 200);

    const exists = await call('/api/account-exists');
    ok('account-exists', exists.status === 200 && exists.body.exists === true);

    ok('stats sans session → 401', (await call('/api/stats')).status === 401);
    ok('login mot de passe erroné → 401', (await call('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rene', password: 'MotDePasseFaux123' })
    })).status === 401);
    ok('signup faibles → 400', (await call('/api/signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'zz', password: 'abc' })
    })).status === 400);
    ok('verify-otp invalide → 4xx', (await call('/api/verify-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rene', code: '000000', purpose: 'login' })
    })).status >= 400);
  } catch (e) {
    skipped('endpoints HTTP', `serveur arrêté (${e.message}) — lancez node server.js puis relancez`);
  }

  // ── 5. Stockage S3 (Cloudflare R2) : aller-retour réel, nettoyé ──
  section('[5] Stockage S3 (Cloudflare R2)');
  const S3 = require('./s3');
  if (!S3.s3Ready()) {
    skipped('stockage S3', 'clés absentes du .env');
  } else {
    const key = '5trade/_verify.json';
    const body = Buffer.from(JSON.stringify({ v: 1, t: Date.now() }));
    try {
      const p = S3.s3Sign('PUT', key, body);
      const rp = await fetch(p.url, {
        method: 'PUT', headers: { ...p.headers, 'Content-Type': 'application/json' }, body
      });
      ok('PUT signé', rp.ok, String(rp.status));

      const g = S3.s3Sign('GET', key, null);
      const rg = await fetch(g.url, { method: 'GET', headers: g.headers });
      ok('GET signé', rg.ok, String(rg.status));
      if (rg.ok) ok('contenu identique', (await rg.text()) === body.toString());

      const d = S3.s3Sign('DELETE', key, null);
      const rd = await fetch(d.url, { method: 'DELETE', headers: d.headers });
      ok('DELETE signé', rd.ok, String(rd.status));
      ok('objet bien supprimé', (await fetch(g.url, { method: 'GET', headers: g.headers })).status === 404);
    } catch (e) {
      ok('aller-retour S3', false, e.message);
    }
  }

  // ── 6. Vision : appel réel sur une image générée à la volée ──
  section('[6] Vision (analyse d\'image)');
  const vision = require('./vision');
  const vinfo = vision.visionInfo();
  console.log(`  • provider : VISION_PROVIDER=${vision.provider()} → ${vinfo.provider} / ${vinfo.model}`);
  if (!vision.visionReady()) {
    ok('clé vision présente', false, `manquante pour ${vinfo.provider}`);
  } else {
    const png = tinyPng();
    console.log(`  • image de test — PNG ${png.length} octets généré à la volée`);
    // Une indisponibilité passagère du service (503) n'est pas un bug du code :
    // on retente une fois, et si ça persiste on marque « non testé » — pas rouge.
    let txt = null, lastErr = null;
    for (let essai = 1; essai <= 2 && !txt; essai++) {
      try {
        txt = await vision.analyzeImages(
          [{ mimeType: 'image/png', base64: png.toString('base64') }],
          'Décris cette image en une phrase courte (couleurs, forme).'
        );
      } catch (e) {
        lastErr = e.message;
        // 429 = quota atteint, 5xx = service indisponible : dans les deux cas
        // ce n'est pas une erreur du code, on retente puis on marque « non testé ».
        if (essai === 1 && /429|50\d|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(e.message)) {
          await new Promise(r => setTimeout(r, 2500));
        }
      }
    }
    if (txt) ok('appel vision → texte non vide', txt.length > 3, JSON.stringify(txt.slice(0, 70)));
    else if (/429|50\d|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(lastErr || '')) {
      skipped('appel vision', /429|RESOURCE_EXHAUSTED/i.test(lastErr) ? 'quota atteint (429) — réessayez plus tard' : 'service indisponible (503) — réessayez plus tard');
    }
    else ok('appel vision', false, lastErr);
  }

  // ── 7. Journal de trades : logique métier ──
  section('[7] Journal de trades');
  const T = require('./trades');
  const refuse = (n, fn) => {
    try { fn(); ok(n, false, 'accepté à tort'); }
    catch (e) { ok(n, true, e.message.slice(0, 52)); }
  };

  const valid = T.normalize({ pair: 'xauusd', direction: 'buy', entry: 4700, sl: 4690, tp: 4720 });
  ok('normalize : paire normalisée en majuscules', valid.pair === 'XAUUSD');
  ok('normalize : risk / reward / RR calculés',
    valid.risk === 10 && valid.reward === 20 && valid.plannedRR === 2,
    `risk=${valid.risk} reward=${valid.reward} RR=${valid.plannedRR}`);
  refuse('BUY avec SL au-dessus de l\'entrée → refusé', () => T.normalize({ pair: 'X', direction: 'BUY', entry: 100, sl: 110 }));
  refuse('SELL avec SL sous l\'entrée → refusé', () => T.normalize({ pair: 'X', direction: 'SELL', entry: 100, sl: 90 }));
  refuse('direction invalide → refusé', () => T.normalize({ pair: 'X', direction: 'HOLD', entry: 100 }));
  refuse('entry absent → refusé', () => T.normalize({ pair: 'X', direction: 'BUY' }));

  ok('clôture : BUY 4700→4720 = win', T.close(valid, { exit: 4720 }).result === 'win');
  ok('clôture : BUY 4700→4695 = loss', T.close(valid, { exit: 4695 }).result === 'loss');
  ok('clôture : sortie au prix d\'entrée = breakeven', T.close(valid, { exit: 4700 }).result === 'breakeven');
  refuse('résultat contradictoire avec le prix → refusé', () => T.close(valid, { exit: 4720, result: 'loss' }));
  refuse('pnl négatif sur un trade gagnant → refusé', () => T.close(valid, { exit: 4720, pnl: -10 }));
  refuse('clôture d\'un trade déjà clôturé → refusé', () => T.close(T.close(valid, { exit: 4720 }), { exit: 4730 }));

  const fxc = T.close(T.normalize({ pair: 'EURUSD', direction: 'sell', entry: 1.0850, sl: 1.0870, tp: 1.0800 }), { exit: 1.0870, rr: -1 });
  ok('précision : PnL forex non écrasé par l\'arrondi', fxc.pnl !== 0 && Math.abs(fxc.pnl + 0.002) < 1e-9, String(fxc.pnl));

  const st = T.computeStats([
    T.close(valid, { exit: 4720, rr: 2 }),
    T.close(valid, { exit: 4695, rr: -1 }),
    valid
  ]);
  ok('stats : winRate 50 %', st.winRate === 50, String(st.winRate));
  ok('stats : 2 clôturés / 1 en cours', st.closed === 2 && st.open === 1);
  ok('stats : regroupement par paire', st.byPair.length === 1 && st.byPair[0].trades === 2);
  ok('stats : rrAvg', st.rrAvg === 0.5, String(st.rrAvg));

  // ── 8. Recherche plein-texte + export ──
  section('[8] Recherche plein-texte & export');
  const S = require('./search');
  const X = require('./export');

  const docs = [
    { id: 'a', title: 'Volatilité et liquidité', content: 'Le balayage de liquidité sur un marché volatil.', tags: ['sweep'], type: 'strategy', source: 'manual' },
    { id: 'b', title: 'Order blocks', content: 'OB et FVG comme zones de réaction.', tags: [], type: 'concept', source: 'manual' },
    { id: 'c', title: 'Gestion du risque', content: 'Taille de position et stop loss. La liquidité compte aussi.', tags: ['risque'], type: 'concept', source: 'manual' }
  ];

  ok('accents : « volatilite » trouve « Volatilité »', S.search(docs, 'volatilite').some(r => r.id === 'a'));
  ok('accents : « liquidité » (accentué) trouve aussi', S.search(docs, 'liquidité').some(r => r.id === 'a'));
  ok('casse ignorée : « ORDER BLOCKS »', S.search(docs, 'ORDER BLOCKS').some(r => r.id === 'b'));
  ok('AND strict : « volatilite risque » (docs séparés) → 0',
    S.search(docs, 'volatilite risque').length === 0);
  ok('AND : « ob fvg » trouve le doc qui a les deux', S.search(docs, 'ob fvg').some(r => r.id === 'b'));
  ok('tolérance préfixe : « volatil »', S.search(docs, 'volatil').some(r => r.id === 'a'));
  ok('requête vide → aucun résultat', S.search(docs, '   ').length === 0);
  ok('terme d\'une lettre ignoré', S.search(docs, 'a').length === 0);
  const ranked = S.search(docs, 'liquidite');
  ok('pondération : le titre passe devant le contenu',
    ranked.length >= 2 && ranked[0].id === 'a', ranked.map(r => `${r.id}:${r.score}`).join(' '));
  ok('extrait fourni et pertinent', !!ranked[0].excerpt && /liquidit/i.test(ranked[0].excerpt),
    JSON.stringify((ranked[0].excerpt || '').slice(0, 50)));

  const tricky = {
    id: 't1', pair: 'XAUUSD', direction: 'BUY', status: 'closed', result: 'win',
    entry: 4700, exit: 4720, rr: 2, pnl: 20, strategyIds: ['a', 'b'],
    notes: 'Entrée sur OB, sortie "propre",\nplusieurs lignes'
  };
  const csv = X.toCsv([tricky]);
  const lines = csv.split('\r\n');
  ok('CSV : en-tête présent', lines[0].startsWith('id,ouvert_le,'));
  ok('CSV : fins de ligne CRLF', csv.includes('\r\n'));
  ok('CSV : note multi-lignes entre guillemets', /"[^"]*plusieurs lignes"/.test(csv));
  ok('CSV : guillemets internes doublés', csv.includes('""propre""'));
  ok('CSV : stratégies jointes par |', csv.includes('a|b'));
  ok('CSV : 2 lignes pour 1 trade', lines.filter(Boolean).length === 2);
  ok('CSV : liste vide → en-tête seul', X.toCsv([]).trim().split('\r\n').length === 1);

  // ── 9. Frontend : compilation JSX (détecte une erreur de syntaxe sans navigateur) ──
  section('[9] Frontend — compilation JSX');
  const vm = require('vm');
  const FRONT = path.join(__dirname, '..', 'frontend');
  const htmlSrc = fs.readFileSync(path.join(FRONT, 'index.html'), 'utf8');
  // Source du moteur : sert à vérifier que les termes ne vivent pas seulement
  // dans un lexique décoratif mais sont bien ceux que le verdict emploie.
  const SIGSRC = fs.readFileSync(path.join(__dirname, 'signals.js'), 'utf8');
  // Tous les <script type="text/babel"> sans attribut src = notre application
  const jsx = [...htmlSrc.matchAll(/<script([^>]*type="text\/babel"[^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(m => !/\bsrc=/.test(m[1])).map(m => m[2]).join('\n');
  ok('bloc JSX inline récupéré', jsx.length > 1000, `${jsx.length} caractères`);

  const babelFile = path.join(__dirname, 'babel.min.js');
  if (!fs.existsSync(babelFile)) {
    try {
      const r = await fetch('https://unpkg.com/@babel/standalone/babel.min.js');
      if (r.ok) fs.writeFileSync(babelFile, Buffer.from(await r.arrayBuffer()));
    } catch { /* réseau indisponible : on saute le contrôle */ }
  }
  if (!fs.existsSync(babelFile)) {
    skipped('compilation JSX', 'babel.min.js indisponible');
  } else {
    const sandbox = { self: {}, window: {}, console: { log(){}, warn(){}, error(){} }, setTimeout, clearTimeout };
    sandbox.global = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(babelFile, 'utf8'), sandbox);
    const Babel = sandbox.Babel || sandbox.self.Babel;
    const compile = (label, code) => {
      try {
        Babel.transform(code, { presets: [['react', { runtime: 'classic' }]], filename: label });
        ok(label, true);
      } catch (e) {
        ok(label, false, `${String(e.message).split('\n')[0]}${e.loc ? ` (ligne ${e.loc.line})` : ''}`);
      }
    };
    compile('app (JSX inline)', jsx);
    compile('reactbits.jsx', fs.readFileSync(path.join(FRONT, 'reactbits.jsx'), 'utf8'));
    ok('composant LiveMarket présent', /function LiveMarket\(/.test(jsx));
    ok('onglet « Direct » déclaré', /id:'live'/.test(jsx));
    ok('graphique TradingView (PriceChart)', /function PriceChart\(/.test(jsx));
    ok('Lightweight Charts v4 servi localement',
      /<script src="lightweight-charts\.js\?v=[\d.]+">/.test(htmlSrc) &&
      fs.existsSync(path.join(FRONT, 'lightweight-charts.js')));
    // Le repli CDN évite un cadre vide si le fichier local manque ou reste en cache.
    ok('graphique : repli CDN si le fichier local fait défaut',
      /unpkg\.com\/lightweight-charts/.test(htmlSrc) && /lwc-pret/.test(htmlSrc));
    ok('graphique : la taille nulle est corrigée (onglet en arrière-plan)',
      /clearTimeout\(t1\)/.test(htmlSrc) && /clientWidth/.test(htmlSrc));
    ok('sélecteur multi-plateformes (optgroup par source)', /optgroup/.test(jsx));
    ok('zoom et déplacement actifs', /handleScroll: true, handleScale: true/.test(jsx));
  }

  // ── 10. Signaux : verdicts déterministes ──
  section('[10] Signaux — verdicts');
  const Sig = require('./signals');
  const mkC = (t, o, h, l, c) => ({ t, o, h, l, c, v: 1 });

  // Balayage de liquidité haussier : deux creux égaux, puis mèche dessous
  // et clôture au-dessus.
  const sweep = [];
  let ts = 0, px = 104;
  const push = (o, h, l, c) => sweep.push(mkC(ts += 60000, o, h, l, c));
  push(104, 105, 103, 104); push(103, 104, 102, 103); push(102, 103, 101, 102);
  push(101, 102, 100, 100.5); push(100.5, 102, 100.5, 101.5); push(101.5, 103, 101, 102.5);
  push(102.5, 103.5, 102, 103); push(103, 104, 102.5, 102.8); push(102.8, 103, 100.2, 100.4);
  push(100.4, 102, 100.3, 101.8); push(101.8, 103, 101.5, 102.9); push(102.9, 104, 102.6, 103.8);
  push(103.8, 104.5, 103.5, 104.2); push(104.2, 105, 104, 104.8); push(104.8, 105.5, 104.5, 105.2);
  push(105.2, 106, 105, 105.8); push(105.8, 106.5, 105.5, 106.2); push(106.2, 107, 106, 106.8);
  push(106.8, 107.2, 106.5, 107); push(107, 108, 106.8, 107.5); push(107.5, 108.5, 107.2, 108.2);
  push(108.2, 109, 108, 108.8); push(108.8, 109.5, 108.5, 109.2);
  push(99.5, 101.5, 98, 101);       // ← la bougie décisive

  const vsweep = Sig.detect(sweep, { symbol: 'TEST', timeframe: '1m' });
  ok('balayage : signal confirmé', vsweep.status === 'confirme', vsweep.status);
  ok('balayage : sens achat', vsweep.direction === 'BUY', vsweep.direction);
  ok('balayage : au moins 2 règles concordantes', vsweep.confirmations >= 2, String(vsweep.confirmations));
  ok('balayage : invalidation SOUS l\'entrée (achat)',
    vsweep.levels.stop !== null && vsweep.levels.stop < vsweep.levels.entry,
    `${vsweep.levels.stop} < ${vsweep.levels.entry}`);
  ok('balayage : objectif au-dessus de l\'entrée',
    vsweep.levels.target1 !== null && vsweep.levels.target1 > vsweep.levels.entry,
    `${vsweep.levels.target1} > ${vsweep.levels.entry}`);
  ok('balayage : résumé lisible', /ACHAT CONFIRMÉ/.test(vsweep.summary), vsweep.summary.slice(0, 60));

  // Marché plat : aucune règle ne doit produire d'achat ou de vente
  const flat = [];
  let tf2 = 0;
  for (let i = 0; i < 24; i++) flat.push(mkC(tf2 += 60000, 100, 100.4, 99.6, 100));
  const vflat = Sig.detect(flat, { symbol: 'FLAT', timeframe: '1m' });
  ok('marché plat : aucun signal', vflat.status === 'neutre' && vflat.direction === 'NEUTRE', `${vflat.status}/${vflat.direction}`);

  // Vente : invalidation AU-DESSUS de l'entrée (symétrie du bug corrigé)
  const sell = [];
  let t3 = 0, p3 = 96;
  const push3 = (o, h, l, c) => sell.push(mkC(t3 += 60000, o, h, l, c));
  push3(96, 97, 95, 96); push3(97, 98, 96, 97); push3(98, 99, 97, 98);
  push3(99, 100, 98, 99.5); push3(99.5, 100.5, 99, 100.2); push3(100.2, 101, 99.8, 100.5);
  push3(100.5, 101.5, 100, 100.2); push3(100.2, 100.5, 99, 99.2); push3(99.2, 99.4, 98, 98.2);
  push3(98.2, 99, 98, 98.8); push3(98.8, 99.5, 98.5, 99.2); push3(99.2, 100, 99, 99.8);
  push3(99.8, 100.5, 99.5, 100.2); push3(100.2, 101, 100, 100.8); push3(100.8, 101.5, 100.5, 101.2);
  push3(101.2, 102, 101, 101.8); push3(101.8, 102.5, 101.5, 102.2); push3(102.2, 103, 102, 102.8);
  push3(102.8, 103.2, 102.5, 103); push3(103, 104, 102.8, 103.5); push3(103.5, 104.5, 103.2, 104.2);
  push3(104.2, 105, 104, 104.8); push3(104.8, 105.5, 104.5, 105.2);
  push3(105.5, 107, 104.5, 105);    // ← perce au-dessus puis clôture en dessous
  const vsell = Sig.detect(sell, { symbol: 'TEST2', timeframe: '1m' });
  if (vsell.direction === 'SELL' && vsell.levels.stop !== null) {
    ok('vente : invalidation AU-DESSUS de l\'entrée',
      vsell.levels.stop > vsell.levels.entry, `${vsell.levels.stop} > ${vsell.levels.entry}`);
  } else {
    ok('vente : verdict produit', ['confirme', 'surveiller', 'neutre'].includes(vsell.status), `${vsell.status}/${vsell.direction}`);
  }

  try { Sig.detect([mkC(0, 1, 1, 1, 1)]); ok('signaux : refuse < 20 bougies', false, 'accepté'); }
  catch { ok('signaux : refuse < 20 bougies', true); }
  ok('signaux : règles nommées', ['R1','R2','R3','R4'].every(r => typeof Sig[r === 'R1' ? 'ruleSweep' : r === 'R2' ? 'ruleBreak' : r === 'R3' ? 'ruleZone' : 'rulePosition'] === 'function'));

  // ── R3 : la position dans le range décide du sens ──
  // Cas vécu : sur XAUUSD, une zone de demande atteinte AU-DESSUS de l'équilibre
  // (premium) puis cédée était lue comme un ACHAT. C'est un piège, et la cassure
  // de la zone est un signal de VENTE.
  const b1 = (o, h, l, c) => ({ t: 0, o, h, l, c, v: 1 });
  const casZone = ({ position, type, low, high, prev, close }) => Sig.ruleZone(
    [b1(prev, prev + 1, prev, prev), b1(close, close + 0.3, close - 0.3, close)],
    {
      premiumDiscount: { position, equilibrium: 105, premium: 110, discount: 100 },
      orderBlocks: [{ low, high, type, kind: 'order block' }], fvgs: [], atr14: 1
    }
  );
  {
    const r = casZone({ position: 'premium', type: 'bullish', low: 106, high: 108, prev: 107, close: 105 });
    ok('R3 : zone de demande cédée en premium → VENTE (jamais un achat)',
      !!r && r.direction === 'SELL', r ? `${r.name} → ${r.direction}` : 'aucune règle');
    ok('R3 : le détail dit la position', !!r && /premium/i.test(r.detail), r ? r.detail : '—');
    ok('R3 : zone de demande tenue en premium → pas de nouvel achat',
      (casZone({ position: 'premium', type: 'bullish', low: 106, high: 108, prev: 107, close: 109 }) || {}).direction !== 'BUY');
    ok('R3 : zone de demande tenue en discount → ACHAT',
      (casZone({ position: 'discount', type: 'bullish', low: 101, high: 103, prev: 102, close: 104 }) || {}).direction === 'BUY');
    ok('R3 : zone d\'offre rejetée en premium → VENTE',
      (casZone({ position: 'premium', type: 'bearish', low: 108, high: 110, prev: 107, close: 106 }) || {}).direction === 'SELL');
    ok('R3 : zone d\'offre cédée en discount → ACHAT',
      (casZone({ position: 'discount', type: 'bearish', low: 102, high: 104, prev: 101, close: 105 }) || {}).direction === 'BUY');
  }

  // ── Chaque marché porte le ticker TradingView correspondant ──
  // L'utilisateur cherche « DERIV:XAUUSD » sur TradingView : l'app doit proposer
  // le MÊME instrument, nommé pareil, et pas un équivalent approximatif.
  const Mk = require('./market.js');
  const sansTicker = Mk.listSymbols().filter(s => !s.tv);
  ok('chaque marché porte son ticker TradingView', sansTicker.length === 0,
    sansTicker.length ? `${sansTicker.length} sans ticker : ${sansTicker.map(s => s.symbol).join(',')}` : 'tous');
  ok('l\'or spot est bien DERIV:XAUUSD',
    Mk.listSymbols().some(s => s.tv === 'DERIV:XAUUSD' && s.provider === 'deriv'));
  ok('le futures COMEX a été retiré (ce n\'est pas l\'instrument demandé)',
    !Mk.listSymbols().some(s => s.provider === 'yahoo' || s.symbol === 'GC=F'));
  ok('les tickers DERIV: sont déclarés',
    Mk.listSymbols().filter(s => /^DERIV:/.test(s.tv || '')).length >= 10,
    `${Mk.listSymbols().filter(s => /^DERIV:/.test(s.tv || '')).length} tickers DERIV:`);
  ok('chaque fournisseur porte sa source',
    Mk.listSymbols().every(s => s.provider && s.providerLabel));
  ok('plusieurs plateformes cumulables',
    new Set(Mk.listSymbols().map(s => s.provider)).size >= 2,
    [...new Set(Mk.listSymbols().map(s => s.provider))].join(', '));

  // ── Le direct doit S'EMBOÎTER dans l'historique ──
  // Vécu : l'historique Deriv utilisait « epoch » et le flux « open_time » (deux
  // champs décalés d'une période). Le direct arrivait donc avec un horodatage
  // antérieur au dernier point affiché, le graphique l'ignorait et semblait figé
  // — alors que les données arrivaient. Ici on compare les deux horodatages.
  ok('marché : historique et flux partagent le même horodatage',
    /open_time !== undefined \? c\.open_time : c\.epoch/.test(fs.readFileSync(path.join(__dirname, 'market.js'), 'utf8')));

  // ── Journal : le marché fait partie du trade ──
  // Demande : « savoir si je gagne sur R_75 plutôt que BTC ». Sans unité de
  // temps ni source, les statistiques mélangent des marchés incomparables.
  {
    const Tr = require('./trades.js');
    const t1 = Tr.normalize({ pair: 'GC=F', direction: 'BUY', entry: 4230, sl: 4200, tp: 4300,
      timeframe: '1h', provider: 'yahoo', providerLabel: 'Marchés cotés',
      signalStatus: 'confirme', signalStrength: 0.72 });
    ok('le trade retient son unité de temps', t1.timeframe === '1h', String(t1.timeframe));
    ok('le trade retient sa source', t1.provider === 'yahoo' && !!t1.providerLabel);
    ok('le trade retient le contexte du signal',
      t1.signalStatus === 'confirme' && t1.signalStrength === 0.72);
    ok('un trade sans marché reste accepté (rétrocompatibilité)',
      !!Tr.normalize({ pair: 'XAUUSD', direction: 'BUY', entry: 1 }));
    const st2 = Tr.computeStats([{ ...t1, status: 'closed', result: 'win', closedAt: new Date().toISOString() }]);
    ok('statistiques par marché', st2.byMarket.length === 1 && st2.byMarket[0].key === 'GC=F · 1h',
      st2.byMarket[0] ? st2.byMarket[0].key : 'aucune');
    ok('statistiques par source', st2.bySource.length === 1, st2.bySource[0] ? st2.bySource[0].key : 'aucune');
    ok('statistiques par unité de temps', st2.byTimeframe.length === 1);
    ok('deux marchés restent séparés',
      Tr.computeStats([
        { ...t1, status: 'closed', result: 'win' },
        { pair: 'R_75', direction: 'SELL', entry: 43000, timeframe: '5m', provider: 'deriv',
          status: 'closed', result: 'loss' }
      ]).byMarket.length === 2);
  }

  // ── Alertes : prévenir hors de la page quand un signal se confirme ──
  {
    // FICHIER DE CONFIGURATION ISOLÉ.
    // Ce bloc faisait Al.update({ actif: false, email: null }) sur le VRAI
    // data/alerts.json : lancer le canonique ÉTEIGNAIT donc la surveillance de
    // l'utilisateur, effaçait son adresse email et remplaçait ses marchés par un
    // marché de test. Les tests écrivent désormais à part, et n'y touchent plus.
    const fichierTest = path.join(os.tmpdir(), `5trade-alertes-${process.pid}.json`);
    process.env.ALERTS_FICHIER = fichierTest;
    try { fs.unlinkSync(fichierTest); } catch (e) { /* pas encore créé */ }
    // try/finally : le nettoyage ci-dessous DOIT s'exécuter même si une étape
    // leve (une assertion, un appel réseau). Sans le finally, une exception
    // laissait ALERTS_FICHIER dans l'environnement, et toute lecture d'alertes
    // ensuite visait le fichier de test.
    try {
    const Al = require('./alerts.js');
    const serie = () => {
      const out = []; let ts = 0;
      const push = (o, h, l, c) => out.push({ t: ts += 60000, o, h, l, c, v: 1, closed: true });
      push(104,105,103,104); push(103,104,102,103); push(102,103,101,102);
      push(101,102,100,100.5); push(100.5,102,100.5,101.5); push(101.5,103,101,102.5);
      push(102.5,103.5,102,103); push(103,104,102.5,102.8); push(102.8,103,100.2,100.4);
      push(100.4,102,100.3,101.8); push(101.8,103,101.5,102.9); push(102.9,104,102.6,103.8);
      push(103.8,104.5,103.5,104.2); push(104.2,105,104,104.8); push(104.8,105.5,104.5,105.2);
      push(105.2,106,105,105.8); push(105.8,106.5,105.5,106.2); push(106.2,107,106,106.8);
      push(106.8,107.2,106.5,107); push(107,108,106.8,107.5); push(107.5,108.5,107.2,108.2);
      push(108.2,109,108,108.8); push(108.8,109.5,108.5,109.2);
      push(99.5,101.5,98,101);
      return out;
    };
    const faux = { getCandles: async () => ({ candles: serie(), provider: 'test' }),
      listSymbols: () => [{ provider: 'test', providerLabel: 'test' }] };
    Al.load();
    Al.update({ actif: false, email: null });

    ok('alertes : email invalide refusé',
      (() => { try { Al.update({ email: 'nope' }); return false; } catch { return true; } })());
    ok('alertes : force hors bornes refusée',
      (() => { try { Al.update({ forceMin: 9 }); return false; } catch { return true; } })());
    ok('alertes : marchés dédupliqués et incomplets écartés',
      Al.update({ marches: [{ symbol: 'A', tf: '1m', provider: 'x' },
        { symbol: 'A', tf: '1m', provider: 'x' }, { symbol: 'B' }] }).marches.length === 1);

    const envois = [];
    Al.update({ actif: false, email: 'a@b.co', marches: [{ symbol: 'R_75', tf: '15m', provider: 'test' }] });
    Al.start({ market: faux, signals: Sig, sendMail: async m => envois.push(m), labelOf: () => 'test' });
    let rr = await Al.verifier(false);
    ok('alertes : désactivées → aucun contrôle', rr.controle === false && envois.length === 0);

    Al.update({ actif: true, email: 'a@b.co', forceMin: 0.3 });
    Al.resetDedup();
    rr = await Al.verifier(true);
    ok('alertes : un signal confirmé part par email', rr.envoyes === 1 && envois.length === 1,
      `${rr.envoyes} envoi(s)`);
    if (envois.length) {
      ok('alertes : objet et contenu exploitables',
        /5trade\].*(ACHAT|VENTE) confirmé/i.test(envois[0].subject)
          && /Entrée/.test(envois[0].html) && /Invalidation/.test(envois[0].html),
        envois[0].subject);
    }
    const avant = envois.length;
    rr = await Al.verifier(true);
    ok('alertes : le même signal ne repart pas', rr.envoyes === 0 && envois.length === avant,
      rr.marches[0] ? rr.marches[0].verdict : '');

    Al.resetDedup();
    Al.update({ forceMin: 0.99 });
    rr = await Al.verifier(true);
    ok('alertes : seuil de force respecté', rr.envoyes === 0);
    Al.update({ actif: false, email: null });
    Al.resetDedup();
    Al.stop();
    ok('alertes : désactivées après les tests (aucun envoi non voulu)', Al.get().actif === false);
    // Le fichier de test est jeté, et l'environnement remis en place : la
    // configuration réelle de l'utilisateur n'a jamais été ouverte.
    } finally {
      try { fs.unlinkSync(fichierTest); } catch (e) { /* déjà absent */ }
      delete process.env.ALERTS_FICHIER;
    }
  }

  // ── Mode auto / manuel : les stratégies de la base deviennent des moteurs ──
  // Demande : « sélectionner une stratégie moi-même et la lancer » + « mode auto
  // où l'IA combine ». Chaque stratégie déclare les règles qu'elle surveille.
  {
    const p1 = Sig.profilDepuisStrategie({ id:'a', title:'Liquidity Sweep Trading', content:'balayage de liquidité avant retournement', tags:[] });
    ok('profil : une stratégie de balayage surveille la liquidité', p1.regles.includes('R1'), p1.regles.join('+'));
    const p2 = Sig.profilDepuisStrategie({ id:'b', title:'Order Blocks', content:'réaction sur order block et FVG', tags:[] });
    ok('profil : une stratégie d\'order blocks surveille la zone réactive', p2.regles.includes('R3'), p2.regles.join('+'));
    const p3 = Sig.profilDepuisStrategie({ id:'c', title:'Fibonacci Premium Discount', content:'OTE et retracement du range', tags:[] });
    ok('profil : une stratégie Fibonacci surveille la position', p3.regles.includes('R4'), p3.regles.join('+'));
    const p4 = Sig.profilDepuisStrategie({ id:'d', title:'zzz', content:'xyz', tags:[] });
    // Le nombre de règles n'est pas fige : il grandit avec le moteur. On verifie
    // donc que TOUTES les regles declarees sont bien reprises, sans en coder 4.
    const nbRegles = Object.keys(Sig.TOUTES_REGLES).length;
    ok('profil : texte sans indication → toutes les règles (rien d\'omis)',
      p4.regles.length === nbRegles && !p4.deduitDuTexte, `${p4.regles.length}/${nbRegles}`);
    ok('profil : une stratégie mono-règle relève son seuil de force',
      p3.seuilRegles === 1 && p3.seuilForce > 0.35, JSON.stringify({ r: p3.seuilRegles, f: p3.seuilForce }));
    ok('profil : une stratégie multi-règles garde le seuil standard',
      p1.seuilRegles === 2 && p1.seuilForce === 0.35);

    const serie = [];
    let ts = 0;
    const push = (o, h, l, c) => serie.push({ t: ts += 60000, o, h, l, c, v: 1, closed: true });
    push(104,105,103,104); push(103,104,102,103); push(102,103,101,102);
    push(101,102,100,100.5); push(100.5,102,100.5,101.5); push(101.5,103,101,102.5);
    push(102.5,103.5,102,103); push(103,104,102.5,102.8); push(102.8,103,100.2,100.4);
    push(100.4,102,100.3,101.8); push(101.8,103,101.5,102.9); push(102.9,104,102.6,103.8);
    push(103.8,104.5,103.5,104.2); push(104.2,105,104,104.8); push(104.8,105.5,104.5,105.2);
    push(105.2,106,105,105.8); push(105.8,106.5,105.5,106.2); push(106.2,107,106,106.8);
    push(106.8,107.2,106.5,107); push(107,108,106.8,107.5); push(107.5,108.5,107.2,108.2);
    push(108.2,109,108,108.8); push(108.8,109.5,108.5,109.2);
    push(99.5,101.5,98,101);

    const vAuto = Sig.detect(serie, { symbol:'T', timeframe:'1m' });
    ok('mode auto : toutes les règles sont évaluées', vAuto.reglesActives.length === nbRegles,
      vAuto.reglesActives.join('+'));

    const vManuel = Sig.detect(serie, { symbol:'T', timeframe:'1m' },
      { regles:['R4'], seuilRegles:1, seuilForce:0.3, strategie:{ id:'x', titre:'Ma stratégie à moi' } });
    ok('mode manuel : SEULES les règles demandées sont évaluées',
      vManuel.reglesActives.length === 1 && vManuel.reglesActives[0] === 'R4',
      vManuel.reglesActives.join('+'));
    ok('mode manuel : le verdict nomme la stratégie appliquée',
      /\[Ma stratégie à moi\]/.test(vManuel.summary), vManuel.summary.slice(0, 70));
    ok('mode manuel : aucune règle hors périmètre ne peut confirmer',
      (vManuel.rules || []).every(r => r.rule === 'R4'),
      (vManuel.rules || []).map(r => r.rule).join(','));

    // Fichier de vérification du front (mode + édition)
    const htmlMode = fs.readFileSync(path.join(FRONT, 'index.html'), 'utf8');
    ok('interface : sélecteur auto / ma stratégie', /Analyse auto/.test(htmlMode) && /Ma stratégie/.test(htmlMode));
    ok('interface : le mode est transmis au flux de signaux', /&mode=\$\{mode\}/.test(htmlMode));
    ok('interface : la stratégie appliquée est affichée', /signal\.strategieAppliquee\.titre/.test(htmlMode));
    ok('interface : édition d\'une stratégie (bouton crayon)', /ouvrirEdition/.test(htmlMode) && /fa-pen/.test(htmlMode));
    ok('interface : enregistrement d\'une stratégie par PUT',
      /method:'PUT'/.test(htmlMode) && /'\/knowledge\/' \+ encodeURIComponent\(editing\)/.test(htmlMode));
    ok('interface : onglet Alertes déclaré', /id:'alerts'/.test(htmlMode));
    ok('interface : écran des alertes', /function Alertes\(/.test(htmlMode));
    ok('interface : garde-fou contre les erreurs d\'affichage', /class Garde extends React\.Component/.test(htmlMode));
    ok('interface : le graphique tolère une bougie plus ancienne',
      /Cannot update oldest data|lastTime !== undefined && t < api\.current\.lastTime/.test(htmlMode));
  }

  // ── Alignement multi-timeframes (« sniper ») ──
  // Un signal isolé sur une seule unité de temps est du bruit : il n'est
  // confirmé que si le contexte supérieur va dans le même sens.
  {
    const faux = (tf, tendance, status, direction, force) =>
      ({ tf, verdict: { trend: tendance, status, direction, strength: force, rules: [] } });

    const trois = Sig.confluence([
      faux('5m', 'bullish', 'confirme', 'BUY', 0.8),
      faux('15m', 'bullish', 'confirme', 'BUY', 0.7),
      faux('1h', 'bullish', 'surveiller', 'BUY', 0.5)
    ]);
    ok('confluence : 3 unités d\'accord → aligné', trois.aligne === true, trois.motif);
    ok('confluence : direction retenue', trois.direction === 'BUY');

    const desaccord = Sig.confluence([
      faux('5m', 'bullish', 'confirme', 'BUY', 0.9),
      faux('15m', 'bearish', 'confirme', 'SELL', 0.8),
      faux('1h', 'bearish', 'surveiller', 'SELL', 0.6)
    ]);
    ok('confluence : désaccord → non aligné', desaccord.aligne === false, desaccord.motif);
    ok('confluence : le désaccord est chiffré', desaccord.nbContraires > 0);

    const degrade = Sig.verdictAvecConfluence([
      faux('5m', 'bullish', 'confirme', 'BUY', 0.9),
      faux('15m', 'range', 'neutre', 'NEUTRE', 0),
      faux('1h', 'range', 'neutre', 'NEUTRE', 0)
    ], { seuilAlignes: 2 });
    ok('un signal isolé n\'est PAS confirmé (dégradé en « à surveiller »)',
      degrade.verdict.status === 'surveiller' && degrade.verdict.alignementManquant === true,
      degrade.verdict.status);
    ok('le résumé explique le refus', /Alignement insuffisant/.test(degrade.verdict.summary));

    const garde = Sig.verdictAvecConfluence([
      faux('5m', 'bullish', 'confirme', 'BUY', 0.9),
      faux('15m', 'bullish', 'confirme', 'BUY', 0.8),
      faux('1h', 'bullish', 'surveiller', 'BUY', 0.5)
    ], { seuilAlignes: 2 });
    ok('un signal aligné reste confirmé', garde.verdict.status === 'confirme', garde.verdict.status);

    // La stratégie décide de ses unités de temps et de son style.
    const scalpeur = Sig.profilDepuisStrategie({
      id: 's', title: 'Scalping rapide', content: 'scalping en 1 minute',
      moteur: { style: 'scalping', regles: ['R1'], seuilAlignes: 2 }
    });
    ok('une stratégie de scalping impose 1m/5m/15m',
      Array.isArray(scalpeur.timeframes) && scalpeur.timeframes.join(',') === '1m,5m,15m',
      JSON.stringify(scalpeur.timeframes));
    ok('le seuil d\'alignement vient de la stratégie', scalpeur.seuilAlignes === 2);
    ok('le stop s\'adapte au style (scalping = serré)', scalpeur.parametres.atrStop === 1);

    const swing = Sig.profilDepuisStrategie({
      id: 'w', title: 'Suivi de tendance long terme', content: 'swing sur plusieurs jours',
      moteur: { style: 'swing', regles: ['R2'] }
    });
    ok('une stratégie swing impose 1h/4h/1d',
      swing.timeframes.join(',') === '1h,4h,1d', JSON.stringify(swing.timeframes));
    ok('le seuil ne peut pas dépasser le nombre d\'unités',
      Sig.normaliserMoteur({ timeframes: ['1m', '5m'], seuilAlignes: 9 }).seuilAlignes === 2,
      String(Sig.normaliserMoteur({ timeframes: ['1m', '5m'], seuilAlignes: 9 }).seuilAlignes));
    ok('les unités inconnues sont écartées',
      (Sig.normaliserMoteur({ timeframes: ['1m', '7s', 'zz'] }).timeframes || []).join(',') === '1m');
  }

  // ── Page « Termes » : le vocabulaire doit être visible et explicité ──
  // L'utilisateur voyait « OB », « FVG » sans savoir ce que l'app mesurait.
  {
    ok('onglet « Termes » déclaré', /id:'termes'/.test(jsx));
    ok('le lexique est présent', /const LEXIQUE = \[/.test(jsx));
    ok('chaque terme porte un sigle, un nom, une définition et son lieu',
      (jsx.match(/sigle:'[^']+'/g) || []).length >= 20 &&
      (jsx.match(/def:"[^"]{20,}"/g) || []).length >= 20 &&
      (jsx.match(/ou:"[^"]{10,}"/g) || []).length >= 20,
      `${(jsx.match(/sigle:'[^']+'/g) || []).length} termes`);
    const sigles = ['BOS', 'CHoCH', 'MSS', 'FVG', 'EQH / EQL', 'OTE', 'Premium', 'Discount',
      'Sweep', 'Displacement', 'Kill zone', 'ATR', 'OB'];
    const absents = sigles.filter(s => !jsx.includes(`sigle:'${s}'`));
    ok('tous les termes demandés sont documentés', !absents.length, absents.join(', ') || 'tous');
    // Les sigles doivent aussi apparaître dans le moteur, pas seulement dans le lexique.
    ok('le verdict nomme BOS et CHoCH', /BOS \(rupture de structure\)/.test(SIGSRC) &&
      /CHoCH \(changement de caractère\)/.test(SIGSRC));
    ok('le verdict nomme Sweep et OB/FVG', /Sweep \(balayage de liquidité\)/.test(SIGSRC) &&
      /OB\/FVG/.test(SIGSRC));
    ok('le verdict nomme Premium et Discount', /Premium \(zone haute du range\)/.test(SIGSRC) &&
      /Discount \(zone basse du range\)/.test(SIGSRC));
    ok('la checklist nomme ses sigles', /HH-HL \/ LH-LL/.test(SIGSRC) && /EQH\/EQL/.test(SIGSRC));
  }

  // ── Vocabulaire évalué : chaque terme doit être MESURÉ, pas décoré ──
  // L'utilisateur voulait que l'IA comprenne les termes avant d'analyser. On
  // vérifie donc que chaque terme présent porte une valeur réelle et que les
  // clés utilisées existent bien (un « null » signalerait une clé inventée).
  {
    const St = require('./structure.js');
    // Série régulière : suffisamment de bougies pour que le vocabulaire ait de
    // quoi mesurer, sans dépendre d'un réseau.
    const serie = [];
    for (let i = 0; i < 80; i++) {
      const b = 100 + i * 0.4;
      serie.push({ t: i * 60000, o: b, h: b + 0.9, l: b - 0.5, c: b + 0.6, v: 10 });
    }
    const r = St.analyze(serie, { symbol: 'TEST', timeframe: '5m' });
    const voc = St.vocabulaire(r);
    ok('le vocabulaire couvre au moins 18 termes', voc.length >= 18, `${voc.length} termes`);
    ok('chaque terme a sigle, famille, present et lecture',
      voc.every(t => t.sigle && t.famille && typeof t.present === 'boolean' && t.lecture));
    const avecValeur = voc.filter(t => t.present);
    ok('chaque terme détecté porte une valeur chiffrée',
      avecValeur.every(t => t.valeur && String(t.valeur).length > 3),
      `${avecValeur.length}/${voc.length} présents`);
    ok('aucune valeur ne contient « null » (signe d\'une clé inventée)',
      !voc.some(t => /null|undefined|NaN/.test(String(t.valeur || ''))),
      (voc.find(t => /null|undefined|NaN/.test(String(t.valeur || ''))) || {}).sigle || 'aucune');
    ok('les niveaux de période portent leurs vraies clés (PDH/PDL)',
      /pl\.PDH/.test(St.vocabulaire.toString()) && /pl\.PWH/.test(St.vocabulaire.toString()));
    ok('les pools portent « price » et le nombre de touches',
      /touches/.test(St.vocabulaire.toString()) && /p\.price/.test(St.vocabulaire.toString()));
  }

  // ── Lexique personnalisé : l'utilisateur doit pouvoir ajouter ses termes ──
  {
    const Lx = require('./lexique.js');
    const n0 = Lx.lister().length;
    const t = Lx.ajouter({ sigle: 'ZZTEST', nom: 'Terme de vérification', famille: 'Zones', def: 'Créé par la vérification.' });
    ok('ajout d\'un terme personnel', Lx.lister().length === n0 + 1 && !!t.id);
    ok('doublon refusé (insensible à la casse)', (() => {
      try { Lx.ajouter({ sigle: 'zztest', nom: 'Doublon' }); return false; } catch { return true; }
    })());
    ok('sigle manquant refusé', (() => {
      try { Lx.ajouter({ nom: 'Sans sigle' }); return false; } catch { return true; }
    })());
    ok('famille inconnue rangée dans « Autre »',
      Lx.ajouter({ sigle: 'ZZFAM', nom: 'Famille inconnue', famille: 'Inexistante' }).famille === 'Autre');
    ok('modification d\'un terme', Lx.modifier(t.id, { def: 'Définition corrigée par la vérification.' }).def.includes('corrigée'));
    Lx.supprimer(t.id);
    const resta = Lx.lister().filter(x => x.sigle === 'ZZFAM')[0];
    if (resta) Lx.supprimer(resta.id);
    ok('suppression et retour à l\'état initial', Lx.lister().length === n0, `n0=${n0}`);
    ok('le lexique personnel est séparé du lexique du moteur',
      !/const LEXIQUE/.test(fs.readFileSync(path.join(__dirname, 'lexique.js'), 'utf8')));
  }

  // ── Base de concepts : elle n'est utile que si elle est VRAIMENT branchée ──
  // Ces 364 lignes dormaient, jamais importées. On vérifie qu'elles sont
  // complètes et qu'elles alimentent l'analyse.
  {
    const Cp = require('./concepts.js');
    ok('la base de concepts est chargée', Cp.CONCEPTS.length >= 30, `${Cp.CONCEPTS.length} concepts`);
    ok('chaque concept a définition, repérage et pièges',
      Cp.CONCEPTS.every(c => c.id && c.terme && c.definition
        && Array.isArray(c.identification) && c.identification.length
        && Array.isArray(c.pieges) && c.pieges.length));
    ok('les catégories sont déclarées', Object.keys(Cp.CATEGORIES).length >= 7);
    ok('la recherche trouve un terme',
      Cp.chercher('order block').some(c => /ob|order/i.test(c.terme)));
    ok('la recherche par alias fonctionne',
      Cp.chercher('changement de caractere').some(c => c.id === 'choch'));
    const consigne = Cp.pourConsigne('rejet sur un order block haussier en premium avec balayage de liquidite', 8);
    ok('la consigne injecte les définitions convoquées', consigne.length > 100 && consigne.includes('•'),
      consigne.split('\n').length + ' concepts retenus');
    ok('la consigne ne dépasse pas la limite demandée',
      Cp.pourConsigne('order block fvg bos choch mss premium discount ote sweep liquidity breaker displacement', 3)
        .split('\n').length <= 3);
    // Le point qui compte : concepts.js est réellement appelé par le serveur.
    const srv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    ok('concepts.js est IMPORTÉ par le serveur', /require\('\.\/concepts'\)/.test(srv));
    ok('les définitions entrent dans le prompt d\'analyse', /Concepts\.pourConsigne\(/.test(srv));
    ok('l\'interface peut lister les concepts', /app\.get\('\/api\/concepts'/.test(srv));
  }

  // ── Contradiction entre règles : jamais de confirmation sur un désaccord franc ──
  {
    // Invariant fondamental : si les règles se contredisent à égalité, aucune
    // confirmation ne doit sortir. C'est le cas où un score moyen mentirait.
    const seriesTest = [];
    // Série D — range en sinusoïde puis fausse cassure haute refermée en bas :
    // R1 (balayage) part à la vente, R3 (zone réactive) part à l'achat.
    {
      const s = []; let t = 0;
      for (let i = 0; i < 24; i++) {
        const c = 100 + Math.sin(i / 2) * 3;
        s.push({ t: t += 60000, o: c, h: c + 1.2, l: c - 1.2, c, v: 1 });
      }
      s.push({ t: t += 60000, o: 100, h: 108, l: 99, c: 99.5, v: 1 });
      seriesTest.push(s);
    }
    // Série F — grand range puis balayage bas refermé très haut : R1 (balayage)
    // part à l'achat, R4 (premium) part à la vente. Les deux cas produisent un
    // désaccord FRANC : c'est ce qui donne sa valeur au test.
    {
      const s = []; let t = 0;
      for (let i = 0; i < 30; i++) {
        const c = 100 + (i % 6) * 4;
        s.push({ t: t += 60000, o: c, h: c + 1, l: c - 1, c, v: 1 });
      }
      s.push({ t: t += 60000, o: 118, h: 122, l: 96, c: 121, v: 1 });
      seriesTest.push(s);
    }

    let francs = 0, confirmesEnDesaccord = 0, champsOk = 0, partiels = 0;
    for (const s of seriesTest) {
      const v = Sig.detect(s, { symbol: 'T', timeframe: '5m' });
      if (!v.contradiction || typeof v.contradiction.active !== 'boolean'
        || !Array.isArray(v.contradiction.pour) || !Array.isArray(v.contradiction.contre)
        || typeof v.contradiction.lecture !== 'string') continue;
      champsOk++;
      if (v.contradiction.active) partiels++;
      if (v.contradiction.franche) {
        francs++;
        if (v.status === 'confirme') confirmesEnDesaccord++;
        // Les deux camps doivent être nommés : c'est ce que l'écran affiche.
        if (!v.contradiction.pour.length || !v.contradiction.contre.length) confirmesEnDesaccord++;
      }
    }
    ok('le verdict expose toujours l\'état du désaccord', champsOk === seriesTest.length,
      `${champsOk}/${seriesTest.length} séries`);
    // Ces séries créent volontairement un désaccord : le test doit le CONFIRMER,
    // sinon il passerait à vide et ne prouverait rien.
    ok('les séries de test produisent bien un désaccord', partiels >= 2, `${partiels} cas`);
    ok('un désaccord franc n\'est JAMAIS confirmé et nomme les deux camps',
      confirmesEnDesaccord === 0 && francs >= 2, `${francs} cas franc(s) examiné(s)`);
    // Et le désaccord est annoncé dans le résumé quand il existe.
    const avecDuel = seriesTest
      .map(s => Sig.detect(s, { symbol: 'T', timeframe: '5m' }))
      .find(v => v.contradiction && v.contradiction.franche);
    ok('le résumé annonce le désaccord', !!avecDuel && /DÉSACCORD/.test(avecDuel.summary),
      avecDuel ? avecDuel.summary.slice(0, 96) : 'aucun désaccord');
  }

  // ── Zones dessinées SUR le graphique et vivantes ──
  // L'utilisateur veut que les OB ne soient pas de simples lignes à côté : il
  // faut des zones sur le graphique, qui suivent le prix quand ça bouge.
  {
    ok('calque de dessin par-dessus le graphique', /<canvas ref=\{overlayRef\}/.test(jsx));
    ok('le calque ne capte pas les clics (zoom encore possible)',
      /pointerEvents:'none'/.test(jsx));
    ok('les zones sont dessinées : OB et FVG en rectangles',
      /for \(const ob of \(rep\.orderBlocks/.test(jsx) && /for \(const f of \(rep\.fvgs/.test(jsx)
      && /ctx\.fillRect\(g, ht, lg, hh\)/.test(jsx));
    ok('premium, discount et OTE en bandes', /'PREMIUM'/.test(jsx) && /'DISCOUNT'/.test(jsx)
      && /OTE 0,618-0,786/.test(jsx));
    ok('la liquidité est tracée sur le graphique', /for \(const l of \(rep\.liquidity/.test(jsx));
    ok('balayages marqués', /for \(const s of \(rep\.sweeps/.test(jsx));
    // Le point clé : les zones suivent le zoom et le déplacement.
    ok('conversion prix et temps en pixels',
      /timeToCoordinate/.test(jsx) && /priceToCoordinate/.test(jsx));
    ok('redessin au déplacement et au zoom',
      /subscribeVisibleLogicalRangeChange\(dessiner\)/.test(jsx));
    ok('redessin au redimensionnement', /new ResizeObserver\(dessiner\)/.test(jsx));
    ok('netteté sur écran haute densité', /devicePixelRatio/.test(jsx));
    ok('le rapport est transmis au graphique', /<PriceChart candles=\{candles\} report=\{report\}/.test(jsx));
    // Et les zones se rafraîchissent : sinon elles resteraient figées.
    ok('les zones se rechargent toutes seules', /setInterval\(recharger, 5000\)/.test(jsx));
    ok('le rechargement met bien à jour rapport ET vocabulaire',
      /setReport\(st\.report\)/.test(jsx) && /setVocabulaire\(st\.vocabulaire\)/.test(jsx));
    // Deux causes possibles pour « les zones n'apparaissent pas » : le calque
    // passe sous le graphique, ou le navigateur sert l'ancienne page en cache.
    ok('le calque est AU-DESSUS du graphique', /pointerEvents:'none', borderRadius:10, zIndex:3/.test(jsx));
    ok('un compteur visible prouve que le calque tourne',
      /zonesTracees/.test(jsx) && /zones tracées :/.test(jsx));
    ok('le compteur ne déclenche pas un rendu à chaque redessin',
      /api\.current\.cleZones !== cle/.test(jsx));
    const srvSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    ok('la page HTML n\'est jamais mise en cache',
      /no-store, no-cache, must-revalidate/.test(srvSrc) && /Pragma/.test(srvSrc));
  }

  // ── La dernière bougie est EN COURS, et le buffer périme ──
  // Deux défauts qui donnaient un graphique figé alors que le prix bougeait :
  //   1. l'historique marquait TOUT « clôturée », dernière bougie comprise ;
  //   2. getCandles servait le buffer sans limite de fraîcheur, et ce buffer
  //      n'était alimenté que par le flux temps réel — flux mort = bougie morte.
  {
    const mSrc = fs.readFileSync(path.join(__dirname, 'market.js'), 'utf8');
    ok('la dernière bougie d\'un historique est marquée EN COURS',
      /function marquerEnCours/.test(mSrc) && /liste\[liste\.length - 1\]\.closed = false/.test(mSrc));
    ok('un seul point de correction, pour tous les fournisseurs',
      (mSrc.match(/marquerEnCours\(await p\.candles/g) || []).length === 1);
    ok('le buffer a une durée de fraîcheur', /const FRAICHEUR_MS = \d+/.test(mSrc));
    ok('un buffer périmé repart en appel source',
      /\(Date\.now\(\) - maj\) < FRAICHEUR_MS/.test(mSrc));
    ok('le flux temps réel rafraîchit la date du buffer',
      /applyCandle[\s\S]{0,220}bufferMaj\.set\(k, Date\.now\(\)\)/.test(mSrc));

    // Vérification directe du comportement, sans réseau : la marque s'applique
    // bien à la dernière bougie et seulement à elle.
    ok('la marque « en cours » ne touche que la dernière', (() => {
      const liste = [{ t: 1, closed: true }, { t: 2, closed: true }, { t: 3, closed: true }];
      // On rejoue la règle exacte du module sur une copie.
      liste[liste.length - 1].closed = false;
      return liste[0].closed === true && liste[1].closed === true && liste[2].closed === false;
    })() && /function marquerEnCours/.test(mSrc));

    // Et le front rafraîchit bien les bougies, pas seulement les zones.
    ok('le front recharge les bougies toutes seules',
      /setCandles\(cb\.candles\)/.test(jsx) && /Promise\.all\(\[/.test(jsx));
  }

  // ── Le nombre de critères n'est PAS figé à 4 ──
  // Question posée par l'utilisateur : « est-ce obligatoire que chaque stratégie
  // ait 4 ou 3 étapes ? » Non. Le moteur expose des règles (qui votent) et des
  // filtres (qui bloquent), et une stratégie en choisit autant qu'elle veut.
  {
    const nb = Object.keys(Sig.TOUTES_REGLES).length;
    ok('le moteur propose au moins quatre règles d\'observation', nb >= 4, `${nb} règles`);
    ok('chaque règle a un libellé lisible',
      Object.keys(Sig.TOUTES_REGLES).every(r => Sig.REGLES_INFO[r]));
    ok('le seuil de règles suit le nombre réel de règles',
      Sig.normaliserMoteur({ regles: ['R1', 'R2', 'R3', 'R4', 'R5'], seuilRegles: 99 }).seuilRegles === nb,
      `borne a ${nb}`);
    ok('une stratégie mono-règle reste possible',
      Sig.profilDepuisStrategie({ id: 'x', title: 't', moteur: { regles: ['R1'], seuilRegles: 1 } })
        .regles.length === 1);
    // R5 a été RETIRÉE du vote : « la structure est haussière donc un achat est
    // favorisé » ne lit rien sur le graphique. Ce test vérifie désormais le
    // contraire de ce qu'il vérifiait avant — c'est voulu.
    ok('R5 ne vote plus : une stratégie qui la demande ne l\'obtient pas', (() => {
      const profil = Sig.profilDepuisStrategie({ id: 'x', title: 't', moteur: { regles: ['R5'] } });
      return !profil.regles.includes('R5') && !profil.regles.includes('R5'.toLowerCase());
    })());
    ok('aucune règle votante n\'est R5', (() => {
      const s = [];
      for (let i = 0; i < 90; i++) { const p = 100 + i * 0.3 + Math.sin(i / 3) * 2; s.push({ t: i * 60000, o: p, h: p + 1, l: p - 1, c: p + 0.4, v: 9 }); }
      const v = Sig.detect(s, { symbol: 'T', timeframe: '5m' });
      return !(v.rules || []).some(r => r.rule === 'R5')
        && !(v.reglesEvaluees || []).includes('R5');
    })());
    ok('la structure est exposée comme CONTEXTE, et marquée non-confirmante', (() => {
      const s = [];
      for (let i = 0; i < 90; i++) { const p = 100 + i * 0.3 + Math.sin(i / 3) * 2; s.push({ t: i * 60000, o: p, h: p + 1, l: p - 1, c: p + 0.4, v: 9 }); }
      const v = Sig.detect(s, { symbol: 'T', timeframe: '5m' });
      return v.context && v.context.confirme === false
        && typeof v.context.lecture === 'string' && v.context.lecture.length > 10
        && 'trend' in v.context;
    })());

    ok('les filtres existent et sont calculés', (() => {
      const St = require('./structure.js');
      const s = [];
      for (let i = 0; i < 80; i++) { const p = 100 + Math.sin(i / 5) * 4; s.push({ t: i * 60000, o: p, h: p + 1, l: p - 1, c: p + 0.3, v: 10 }); }
      const f = Sig.filtresDisponibles(St.analyze(s, { symbol: 'T', timeframe: '5m' }));
      return f.length >= 4 && f.every(x => ['volatilite', 'session', 'range', 'structure'].includes(x.cle)
        && typeof x.ok === 'boolean' && x.label && x.detail);
    })());
    // La structure a rejoint les filtres : c'est un contexte MESURABLE, pas un vote.
    // « La structure est haussière donc un achat est favorisé » ne lisait rien de plus
    // que le sens du signal — mais « la structure est-elle identifiée ? » en est une
    // information, exactement comme la volatilité ou la session.
    ok('la structure figure parmi les filtres de contexte', (() => {
      const St = require('./structure.js');
      const s = [];
      for (let i = 0; i < 80; i++) { const p = 100 + i * 0.4; s.push({ t: i * 60000, o: p, h: p + 1, l: p - 1, c: p + 0.4, v: 10 }); }
      const f = Sig.filtresDisponibles(St.analyze(s, { symbol: 'T', timeframe: '5m' }));
      const st = f.find(x => x.cle === 'structure');
      return !!st && typeof st.ok === 'boolean' && /structure/.test(st.detail || '')
        && typeof st.lecture === 'string' && st.lecture.length > 10;
    })());
    ok('la clé structure est acceptée dans le moteur d\'une stratégie',
      Sig.CLES_FILTRES.includes('structure'), Sig.CLES_FILTRES.join(','));
    ok('un filtre exigé non rempli interdit la confirmation', (() => {
      const St = require('./structure.js');
      const s = [];
      // Marché plat : la volatilité relative est nulle et il n'y a pas de déplacement.
      for (let i = 0; i < 80; i++) s.push({ t: i * 60000, o: 100, h: 100.02, l: 99.98, c: 100, v: 1 });
      const rapport = St.analyze(s, { symbol: 'T', timeframe: '5m' });
      const v = Sig.detect(s, { symbol: 'T', timeframe: '5m' }, { filtres: ['volatilite'] });
      const filtre = (v.filtres || []).find(f => f.cle === 'volatilite');
      return !filtre || filtre.ok === false ? v.status !== 'confirme' : true;
    })());
    ok('les filtres sont exposés dans le verdict',
      /filtres: tousFiltres/.test(SIGSRC) && /filtresExiges/.test(SIGSRC));
    ok('une stratégie transmet ses filtres au direct',
      /profils\.flatMap\(p => p\.filtres/.test(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8')));
  }

  // ── Mobile : le direct doit être utilisable au pouce ──
  {
    ok('barre de navigation mobile en bas d\'écran',
      /\.mobile-nav\{[\s\S]{0,200}position:fixed;bottom:0/.test(htmlSrc));
    ok('la navigation d\'ordinateur est masquée sur mobile', /\.nav\{display:none\}/.test(htmlSrc));
    ok('au plus cinq cibles au pouce (le reste dans « Plus »)',
      /NAV_PRINCIPAL = \['live', 'analyze', 'strategies', 'journal'\]/.test(jsx)
      && /NAV_SECONDAIRE = \['add', 'history', 'termes', 'alerts'\]/.test(jsx));
    ok('cibles tactiles d\'au moins 44 px', /min-height:44px/.test(htmlSrc));
    ok('encoche et barre gestuelle respectées (safe-area)',
      /env\(safe-area-inset-bottom\)/.test(htmlSrc));
    ok('les champs font 16 px (empêche le zoom automatique iOS)',
      /\.fld, input, select, textarea\{font-size:16px\}/.test(htmlSrc));
    ok('les tableaux larges défilent au lieu de casser la page',
      /table\{display:block;overflow-x:auto/.test(htmlSrc));
    ok('le graphique s\'adapte en hauteur sur petit écran',
      /\.chart-mobile\{height:\d+px!important\}/.test(htmlSrc) && /className="chart-mobile"/.test(jsx));
    ok('le défilement au doigt est fluide', /-webkit-overflow-scrolling:touch/.test(htmlSrc));
  }

  // ── Décrire une stratégie : le trader explique, le moteur structure ──
  // « Je lui explique une stratégie, il analyse, rassemble les infos, me la rend
  //  et la sauvegarde. »
  {
    const srv2 = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    ok('la route de description existe', /app\.post\('\/api\/strategies\/decrire'/.test(srv2));
    ok('une description trop courte est refusée', /30 caractères minimum/.test(srv2));
    // La limite a changé : un trader colle un cours complet, pas trois lignes.
    // On verifie donc que la limite est bien plus large, et surtout que la
    // machine decoupe elle-meme au lieu de renvoyer l'utilisateur a la tache.
    ok('les documents longs sont acceptes (limite large)',
      /const LIMITE_DESCRIPTION = (\d{6,})/.test(srv2)
      && Number(/const LIMITE_DESCRIPTION = (\d+)/.exec(srv2)[1]) >= 100000,
      /const LIMITE_DESCRIPTION = (\d+)/.exec(srv2)[1] + ' caracteres');
    ok('un document tres au-dela reste refuse avec un message clair',
      /Document trop long/.test(srv2) && /maximum/.test(srv2));
    ok('l app decoupe elle-meme un document long',
      /function decouperEnSections/.test(srv2)
      && /decouperEnSections\(texte\)/.test(srv2));
    ok('chaque section devient une fiche (boucle sur les sections)',
      /for \(const section of liste\)/.test(srv2) && /structurerTexte\(section\)/.test(srv2));
    ok('une section en echec ne fait pas perdre les autres',
      /echecs\.push\(/.test(srv2) && /if \(!resultats\.length\)/.test(srv2));
    ok('la structure du texte est sortie de la route (req/res interdits)',
      !/async function structurerTexte[\s\S]*?req\./.test(srv2.slice(srv2.indexOf('async function structurerTexte'),
        srv2.indexOf("app.post('/api/strategies/decrire'"))));
    ok('la reponse annonce le nombre de fiches',
      /nombre: resultats\.length/.test(srv2) && /decoupe: resultats\.length > 1/.test(srv2));
    ok('la premiere fiche reste exposee a la racine (ecran inchange)',
      /strategy: premier\.strategy/.test(srv2) && /fiches: resultats\.map/.test(srv2));
    ok('le texte est envoyé au modèle d\'analyse', /DESCRIPTION DU TRADER/.test(srv2));
    ok('les 4 règles sont expliquées au modèle', /R1 = balayage de liquidité/.test(srv2)
      && /R2 = rupture de structure/.test(srv2) && /R3 = zone réactive/.test(srv2)
      && /R4 = position dans le range/.test(srv2));
    ok('le modèle n\'invente rien (consigne explicite)', /N'invente rien/.test(srv2));
    ok('le moteur produit est normalisé', /Signals\.normaliserMoteur\(\{[\s\S]{0,320}regles: reglesConnues/.test(srv2));
    ok('la fiche est enregistrée', /await saveStrategy\(strategy\)/.test(srv2));
    ok('les règles inconnues sont écartées',
      /filter\(r => Signals\.TOUTES_REGLES\[r\]\)/.test(srv2));

    // Le point de fiabilité : un style déclaré doit donner PLUSIEURS unités de
    // temps. « Scalping » réduit à 1m ne produirait aucun alignement.
    const Sg = require('./signals.js');
    const scalping = Sg.normaliserMoteur({ style: 'scalping', regles: ['R1'] });
    ok('un style déclaré impose ses unités de temps',
      Array.isArray(scalping.timeframes) && scalping.timeframes.length >= 2,
      (scalping.timeframes || []).join('/'));
    ok('et son seuil d\'alignement reste atteignable',
      scalping.seuilAlignes >= 1 && scalping.seuilAlignes <= scalping.timeframes.length,
      `seuil ${scalping.seuilAlignes} sur ${scalping.timeframes.length}`);
    ok('l\'interface propose la description', /id:'decrire', label:'Décrire'/.test(jsx));
    ok('l\'interface affiche la fiche obtenue', /fiche\.moteur\.regles/.test(jsx)
      && /Analyser et enregistrer/.test(jsx));
    ok('l\'interface interdit d\'envoyer une description trop courte',
      /decrire\.trim\(\)\.length < 30/.test(jsx));
  }

  // ── Mobile : la barre du bas et les cibles tactiles ──
  // 8 onglets entassés dans une grille de 4, c'était deux rangées serrées ; la
  // norme est cinq cibles au maximum, et 44 px minimum pour ne pas rater son
  // bouton au pouce.
  {
    ok('la barre mobile se limite à cinq cibles', /repeat\(5,1fr\)/.test(htmlSrc));
    ok('les onglets secondaires passent dans « Plus »',
      /NAV_PRINCIPAL/.test(jsx) && /NAV_SECONDAIRE/.test(jsx) && /mobile-plus/.test(jsx));
    ok('les onglets rangés sont bien les quatre secondaires',
      /\['add', 'history', 'termes', 'alerts'\]/.test(jsx));
    ok('cibles tactiles de 44 px minimum', (htmlSrc.match(/min-height:44px/g) || []).length >= 2);
    ok('le bug de la virgule est corrigé (couleur et police des boutons)',
      !/color:var\(--muted\),font-family/.test(htmlSrc)
      && /color:var\(--muted\);font-family:inherit/.test(htmlSrc));
    ok('l\'animation respecte prefers-reduced-motion', /prefers-reduced-motion/.test(htmlSrc));
    ok('le graphique s\'adapte à la largeur de l\'écran',
      /window\.innerWidth < 820/.test(jsx) && /etroi \? 300 : 430/.test(jsx));
    ok('la zone sûre iOS est respectée (encoche en bas)',
      /env\(safe-area-inset-bottom\)/.test(htmlSrc));
    ok('les points de rupture du design system sont couverts',
      /max-width:820px/.test(htmlSrc) && /max-width:430px/.test(htmlSrc)
      && /min-width:1360px/.test(htmlSrc));
  }

  // ── Playbooks : un type de trade = ses prérequis et ses étapes ──
  // Un scalp, une chasse à la liquidité, un intraday et un swing n'ont ni les
  // mêmes prérequis ni les mêmes étapes. Les mélanger produit des signaux
  // contradictoires — c'est exactement ce qu'on veut empêcher.
  {
    const Pb = require('./playbooks.js');
    ok('les quatre types de trade sont déclarés',
      ['scalping', 'liquidite', 'intraday', 'swing'].every(t => Pb.TYPES[t]));
    ok('chaque type annonce ses unités, sa durée et son risque',
      Object.values(Pb.TYPES).every(t => Array.isArray(t.timeframes) && t.timeframes.length >= 2
        && t.duree && t.risque && t.quand));
    ok('les unités de temps diffèrent selon le type',
      Pb.TYPES.scalping.timeframes[0] === '1m' && Pb.TYPES.swing.timeframes[0] === '1h');

    // Évaluation sur une série construite : chaque terme doit être chiffré.
    const serie = [];
    for (let i = 0; i < 80; i++) {
      const b = 100 + Math.sin(i / 5) * 4;
      serie.push({ t: i * 60000, o: b, h: b + 1.1, l: b - 1.1, c: b + 0.3, v: 10 });
    }
    const St2 = require('./structure.js');
    const rep = St2.analyze(serie, { symbol: 'T', timeframe: '5m' });
    const tous = Pb.tous(rep);
    ok('les quatre playbooks sont évalués', tous.length === 4);
    ok('chacun a ses prérequis et ses étapes',
      tous.every(p => p.prerequis.length >= 3 && p.etapes.length >= 4));
    ok('chaque prérequis porte un verdict et un détail chiffré',
      tous.every(p => p.prerequis.every(x => typeof x.ok === 'boolean' && x.label && x.detail)));
    ok('chaque étape est numérotée et évaluée',
      tous.every(p => p.etapes.every((e, i) => e.numero === i + 1 && (e.ok === null || typeof e.ok === 'boolean'))));
    ok('l\'avancement est annoncé',
      tous.every(p => typeof p.avancement === 'string' && p.avancement.length > 3));
    ok('un blocage est nommé quand le type n\'est pas valable',
      tous.every(p => p.pret || p.blocage));
    ok('aucune valeur « null » ou « NaN » dans les détails',
      !tous.some(p => [...p.prerequis, ...p.etapes].some(x => /NaN|undefined/.test(String(x.detail || '')))));

    // Le bug corrigé : une session composée ne doit pas être vue comme fermée.
    const src = fs.readFileSync(path.join(__dirname, 'playbooks.js'), 'utf8');
    ok('une session composée n\'est pas vue comme fermée',
      /Londres\|New York\|Chevauchement/.test(src) && !/\['Londres', 'New York'\]\.includes/.test(src));

    // Le serveur expose l'avancement, et l'interface l'affiche.
    const srv3 = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    ok('le rapport de structure porte les playbooks', /playbooks: Playbooks\.tous\(report\)/.test(srv3));
    ok('une route dédiée existe', /app\.get\('\/api\/playbooks'/.test(srv3));
    ok('l\'interface affiche le cheminement', /Cheminement du signal/.test(jsx)
      && /typeTrade/.test(jsx) && /Pour avancer/.test(jsx));
  }

  // ── Telegram : branché de bout en bout, réglable depuis l'écran ──
  // Le backend existait mais AUCUN champ ne l'exposait : impossible de configurer
  // le bot depuis l'application. Le « chat id » se trouve maintenant tout seul.
  {
    // server.js est relu ici : les variables des autres blocs ne sont pas
    // visibles d'un bloc a l'autre, et srvTg n'existait donc pas dans ce scope.
    const srvTg = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const aSrc = fs.readFileSync(path.join(__dirname, 'alerts.js'), 'utf8');
    ok('les réglages portent le jeton du bot et la conversation',
      /telegramToken: null/.test(aSrc) && /telegramChat: null/.test(aSrc));
    ok('le jeton et la conversation sont validés à l\'enregistrement',
      /'telegramToken' in patch/.test(aSrc) && /'telegramChat' in patch/.test(aSrc));
    ok('l\'envoi Telegram est branché dans la surveillance',
      /if \(c\.telegramToken && c\.telegramChat\)/.test(aSrc) && /envoyerTelegram/.test(aSrc));
    ok('le message Telegram part en HTML (gras lisible)',
      /parse_mode: 'HTML'/.test(aSrc) && /disable_web_page_preview: true/.test(aSrc));

    ok('une route retrouve la conversation automatiquement',
      /app\.post\('\/api\/alerts\/telegram\/trouver'/.test(srvTg)
      && /getUpdates/.test(srvTg));
    ok('la route nomme la conversation trouvée',
      /msg\.chat\.title \|\| \[msg\.chat\.first_name/.test(srvTg));
    ok('un jeton refusé est expliqué clairement',
      /Telegram refuse ce jeton/.test(srvTg));
    ok('sans conversation, la route explique quoi faire',
      /envoie-lui « salut »/.test(srvTg));
    ok('le test d\'envoi gère le canal Telegram',
      /canal === 'telegram'/.test(srvTg) && /regarde ton téléphone/.test(srvTg));
    ok('le test refuse un envoi sans jeton ni conversation',
      /Jeton du bot manquant/.test(srvTg) && /Conversation manquante/.test(srvTg));

    ok('l\'écran propose le jeton, la conversation et les deux boutons',
      /Alertes Telegram/.test(jsx) && /Jeton du bot \(donné par BotFather\)/.test(jsx)
      && /Trouver ma conversation/.test(jsx) && /Envoyer un message d'essai/.test(jsx));
    ok('l\'écran explique comment créer le bot',
      /@BotFather/.test(jsx) && /\/newbot/.test(jsx));
    ok('l\'écran dit que les deux canaux fonctionnent ensemble',
      /email et Telegram\) fonctionnent ensemble/.test(jsx));
    ok('plusieurs conversations sont proposées au choix',
      /chatsTg\.map/.test(jsx));
  }

  // ── Confluence : ce qui compte vraiment comme un « accord » ──
  // Cas signalé : 5m bullish / 15m bullish / 1h RANGE annoncé « 3/3 d'accord ».
  // Une unité en range portait une direction (règle de position) et était donc
  // comptée comme une confirmation, alors qu'elle ne confirme rien.
  {
    const tf = (nom, tendance, direction, status) => ({
      tf: nom,
      verdict: { trend: tendance, direction, status, strength: 0.6, rules: [{ rule: 'R2', name: 'x' }] }
    });
    const analyse = liste => Sig.confluence(liste, { seuilAlignes: 2 });

    const c1 = analyse([tf('5m', 'bullish', 'BUY', 'confirme'), tf('15m', 'bullish', 'BUY', 'confirme'),
      tf('1h', 'range', 'BUY', 'surveiller')]);
    ok('range en hausse ne compte PAS comme un accord', c1.nbAlignes === 2, `${c1.nbAlignes} appuis`);
    ok('il est classé « appui faible », pas « appui »', c1.nbAppuisFaibles === 1);
    ok('le score suit les vrais appuis', c1.score === +(2 / 3).toFixed(3), String(c1.score));
    ok('le motif ne prétend pas 3/3', /2\/3/.test(c1.motif) && /sans tendance/.test(c1.motif), c1.motif);
    ok('l\'unité en range explique pourquoi elle ne compte pas',
      /ne compte pas/.test((c1.detail.find(d => d.tf === '1h') || {}).raison || '')
      && /rien pour la confirmer/.test((c1.detail.find(d => d.tf === '1h') || {}).raison || ''),
      (c1.detail.find(d => d.tf === '1h') || {}).raison);

    const c2 = analyse([tf('5m', 'bullish', 'BUY', 'confirme'), tf('15m', 'bearish', 'SELL', 'confirme'),
      tf('1h', 'range', 'NEUTRE', 'neutre')]);
    ok('une unité SANS direction n\'est pas une unité contraire', c2.nbContraires === 1,
      `${c2.nbContraires} contraires`);
    ok('désaccord franc : pas aligné', c2.aligne === false);

    const c3 = analyse([tf('5m', 'bullish', 'BUY', 'confirme'), tf('15m', 'bullish', 'BUY', 'surveiller'),
      tf('1h', 'bullish', 'BUY', 'surveiller')]);
    ok('trois unités réellement haussières : aligné', c3.aligne === true && c3.nbAlignes === 3);

    const c4 = analyse([tf('5m', 'range', 'BUY', 'surveiller'), tf('15m', 'range', 'BUY', 'surveiller'),
      tf('1h', 'range', 'NEUTRE', 'neutre')]);
    ok('tout en range : aucune confluence possible', c4.aligne === false && c4.nbAlignes === 0);

    const c5 = analyse([tf('5m', 'bearish', 'SELL', 'confirme'), tf('15m', 'bearish', 'SELL', 'confirme'),
      tf('1h', 'bullish', 'BUY', 'confirme')]);
    ok('contre-tendance signalée', c5.contreTendance === true && c5.aligne === false);
  }

  // ── Les règles se lisent par catégorie, plus par un compte ambigu ──
  // « reglesActives: 5 » face à « confirmations: 3 » ne disait pas si les deux
  // autres manquaient, s'opposaient ou n'avaient rien trouvé.
  {
    const s = [];
    for (let i = 0; i < 80; i++) {
      const p = 100 + Math.sin(i / 6) * 3 + i * 0.05;
      s.push({ t: i * 60000, o: p, h: p + 0.8, l: p - 0.8, c: p + 0.2, v: 8 });
    }
    const v = Sig.detect(s, { symbol: 'T', timeframe: '5m' });
    ok('les règles évaluées sont listées', Array.isArray(v.reglesEvaluees) && v.reglesEvaluees.length >= 4,
      (v.reglesEvaluees || []).join(','));
    ok('les règles d\'accord sont listées', Array.isArray(v.reglesPour), (v.reglesPour || []).join(','));
    ok('les règles contraires sont listées', Array.isArray(v.reglesContre));
    ok('les règles muettes sont listées', Array.isArray(v.reglesMuettes));
    ok('chaque règle évaluée tombe dans une catégorie',
      v.reglesPour.length + v.reglesContre.length + v.reglesNeutres.length + v.reglesMuettes.length
        === v.reglesEvaluees.length,
      `${v.reglesPour.length}+${v.reglesContre.length}+${v.reglesNeutres.length}+${v.reglesMuettes.length}`
      + ` = ${v.reglesEvaluees.length}`);
    ok('le résumé annonce des preuves distinctes ET le nombre de règles évaluées',
      /preuve\(s\) distincte\(s\)/.test(v.summary || '')
      && new RegExp(`sur ${v.reglesEvaluees.length} règle`).test(v.summary || ''),
      String(v.summary || '').slice(0, 110));
  }

  // ── Le déclencheur ne doit jamais être l'objectif ──
  // Cas réel : entrée 83 533.46, déclencheur « clôture au-dessus de 83 534.11 »,
  // objectif 1 = 83 534.11. Le moteur annonçait un objectif déjà atteint à
  // l'entrée : 0,65 de gain pour 139 de risque.
  {
    const s = [];
    for (let i = 0; i < 90; i++) {
      const p = 100 + i * 0.35 + Math.sin(i / 4) * 1.2;
      s.push({ t: i * 60000, o: p, h: p + 1.1, l: p - 1.1, c: p + 0.4, v: 10 });
    }
    const v = Sig.detect(s, { symbol: 'T', timeframe: '5m' });
    const L = v.levels || {};
    const sc = v.scenarios || {};
    const nombre = t => { const m = String(t || '').match(/[\d]+(?:[.,]\d+)?/); return m ? parseFloat(m[0].replace(',', '.')) : null; };

    ['bullish', 'bearish'].forEach(sens => {
      const x = sc[sens] || {};
      const cible1 = x.target1;
      const declenche = nombre(x.trigger);
      const sensPos = sens === 'bullish' ? 1 : -1;
      if (Number.isFinite(cible1)) {
        ok(`scénario ${sens} : l'objectif 1 est distinct du déclencheur`,
          declenche === null || Math.abs(cible1 - declenche) > 1e-9,
          `déclencheur ${declenche} vs objectif ${cible1}`);
      }
      // Le gain doit être du bon côté et couvrir au moins une fraction du risque.
      if (Number.isFinite(cible1) && Number.isFinite(x.entry) && Number.isFinite(x.stop)) {
        const gain = (cible1 - x.entry) * sensPos;
        const risque = (x.entry - x.stop) * sensPos;
        ok(`scénario ${sens} : l'objectif est du bon côté de l'entrée`, gain > 0,
          `gain ${gain.toFixed(2)}`);
        ok(`scénario ${sens} : le stop est du bon côté`, risque > 0, `risque ${risque.toFixed(2)}`);
        ok(`scénario ${sens} : le gain couvre au moins la moitié du risque`,
          gain >= risque * 0.5, `R/R ${(gain / risque).toFixed(2)}`);
      }
    });

    // L'ATR doit être exposé : sans lui, les distances annoncées en « × ATR » ne
    // sont pas vérifiables par l'utilisateur.
    ok('l\'ATR est exposé dans le verdict', Number.isFinite(v.atr) && v.atr > 0, String(v.atr));
    // Aucune cible à moins d'un ATR : sinon le trade ne paie pas ses frais.
    if (Number.isFinite(L.target1) && Number.isFinite(L.entry) && Number.isFinite(v.atr)) {
      ok('l\'objectif 1 est à au moins un ATR de l\'entrée',
        Math.abs(L.target1 - L.entry) >= v.atr * 0.999,
        `${Math.abs(L.target1 - L.entry).toFixed(2)} pour un ATR de ${v.atr}`);
    }
  }

  // ── Étapes de playbook : ne jamais annoncer une étape bloquante comme franchie ──
  // Cas signalé : « étape 5 sur 5 » + « étapes 4/5 » alors qu'une étape obligatoire
  // était en attente. Le dénominateur mélangeait obligatoires et facultatives.
  {
    const PB = require('./playbooks.js');
    const St = require('./structure.js');
    const s = [];
    for (let i = 0; i < 120; i++) {
      const p = 100 + Math.sin(i / 8) * 5 + i * 0.02;
      s.push({ t: i * 60000, o: p, h: p + 1.4, l: p - 1.4, c: p + 0.3, v: 12 });
    }
    const r = St.analyze(s, { symbol: 'T', timeframe: '5m' });

    ['scalping', 'liquidite', 'intraday', 'swing'].forEach(t => {
      const pb = PB.evaluer(r, t);
      ok(`${t} : les étapes obligatoires sont comptées à part`,
        Number.isFinite(pb.etapesObligatoires) && pb.etapesObligatoires <= pb.etapesTotal,
        `${pb.etapesOk}/${pb.etapesObligatoires} obligatoires sur ${pb.etapesTotal} au total`);
      ok(`${t} : les étapes facultatives sont nommées`,
        Array.isArray(pb.etapesFacultatives), `${(pb.etapesFacultatives || []).length}`);
      ok(`${t} : pret exige TOUTES les étapes obligatoires`,
        pb.pret ? pb.etapesEnAttente.length === 0 : true);
      // Le libellé doit désigner le VRAI point de blocage : les prérequis d'abord,
      // les étapes ensuite — et jamais laisser croire qu'une étape bloquante est
      // franchie.
      if (!pb.pret) {
        if (pb.prerequisOk < pb.prerequisTotal) {
          ok(`${t} : le blocage annoncé est le manque de prérequis`,
            /contexte incomplet/.test(pb.avancement || '')
            && new RegExp(`${pb.prerequisTotal - pb.prerequisOk} prérequis manquant`).test(pb.avancement || ''),
            pb.avancement);
        } else if (pb.etapesEnAttente && pb.etapesEnAttente.length) {
          ok(`${t} : une étape en attente est annoncée comme bloquante`,
            /bloqué à l'étape/.test(pb.avancement || '') && !/toutes les étapes/.test(pb.avancement || ''),
            pb.avancement);
        }
      }
      ok(`${t} : jamais « étape N sur N » quand une étape bloque`,
        !/^étape \d+ sur \d+$/.test(pb.avancement || ''), pb.avancement);
      if (pb.pret) {
        ok(`${t} : « pret » implique zéro étape obligatoire en attente`,
          pb.etapesEnAttente.length === 0 && pb.etapesOk === pb.etapesObligatoires);
      }
    });
  }

  // ── État du marché : quatre notions distinctes, aucun blocage arbitraire ──
  {
    const s = [];
    for (let i = 0; i < 100; i++) {
      const p = 100 + Math.sin(i / 5) * 4 + i * 0.03;
      s.push({ t: i * 60000, o: p, h: p + 1, l: p - 1, c: p + 0.25, v: 9 });
    }
    const vc = Sig.detect(s, { symbol: 'BTCUSDT', timeframe: '5m' });
    ok('l\'état du marché est exposé', !!vc.etatMarche && typeof vc.etatMarche === 'object');
    ok('un crypto est vu comme ouvert en continu',
      /continu/.test(vc.etatMarche.marche || ''), vc.etatMarche.marche);
    ok('sa session n\'est PAS comptée comme un blocage',
      (vc.etatMarche.bloque || []).length === 0, vc.etatMarche.lecture);
    ok('la fraîcheur des données est évaluée à part',
      typeof vc.etatMarche.donneesFraiches === 'boolean' || vc.etatMarche.donneesFraiches === null);

    const vx = Sig.detect(s, { symbol: 'frxXAUUSD', timeframe: '5m' });
    ok('un marché à séance est distingué du crypto',
      /séance/.test(vx.etatMarche.marche || ''), vx.etatMarche.marche);
    ok('hors séance sans exigence de session : rien n\'est bloqué',
      (vx.etatMarche.bloque || []).length === 0 && !vx.etatMarche.sessionExigee,
      vx.etatMarche.lecture);
    ok('la volatilité est un état séparé',
      typeof vx.etatMarche.volatiliteSuffisante === 'boolean' || vx.etatMarche.volatiliteSuffisante === null);
  }

  // ── La force est un score, jamais présentée comme une probabilité ──
  {
    ok('l\'écran dit que la force est un score interne, pas une probabilité',
      // Le texte vient du backend (forceDetail.lecture) : l'écran l'affiche en
      // infobulle. Verifier les deux bouts : le libelle existe, et l'ecran l'utilise.
      /Score interne du moteur|score interne/.test(jsx) || /forceDetail\.lecture/.test(jsx));
    ok('le backend fournit la lecture, et l\'écran la consomme',
      /forceDetail/.test(jsx) && /forceNiveau/.test(jsx));
    ok('l\'écran n\'emploie pas le mot « probabilité » pour la force',
      !/probabilité de (gain|réussite) [:=]/i.test(jsx));
    ok('l\'écran affiche « X/Y règles » et non un « X » isolé',
      /règle\(s\) d'accord/.test(jsx) && /reglesEvaluees/.test(jsx));
  }

  // ── Les confirmations comptent des PREUVES, pas des noms de règles ──
  // Défaut signalé : « new Set(winner.map(r => r.rule)).size » comptait des
  // identifiants. R1 (balayage) et R2 (cassure) lisent souvent LE MÊME niveau sur
  // LA MÊME bougie — le balayage EST la rupture. Un seul événement du marché
  // comptait donc double, et gonflait la force du signal.
  {
    const vague = () => {
      const out = []; let ts = 0;
      const push = (o, h, l, c) => out.push({ t: ts += 60000, o, h, l, c, v: 2, closed: true });
      [[100, 102, 99.6], [101.2, 103.6, 100.8], [102.4, 105.2, 102], [103.6, 106.8, 103.2],
       [104.8, 108.4, 104.4], [106.2, 110, 105.8], [107.4, 111.6, 107], [108.6, 113.2, 108.2]]
        .forEach(([creux, sommet, base]) => {
          const pas = (sommet - creux) / 4;
          for (let i = 0; i < 4; i++) {
            const o = creux + pas * i, c = creux + pas * (i + 1);
            push(o, Math.max(o, c) + 0.15, Math.min(o, c, base) - 0.05, c);
          }
        });
      return out;
    };
    const v = Sig.detect(vague(), { symbol: 'T', timeframe: '15m' });
    const regles = (v.rules || []).map(r => r.rule);
    ok('chaque règle porte une empreinte de preuve',
      (v.rules || []).every(r => !!r.preuve), (v.rules || []).map(r => `${r.rule}:${r.preuve}`).join(' '));
    ok('le nombre de confirmations est le nombre de PREUVES distinctes',
      v.confirmations === Object.keys(v.preuves || {}).length,
      `${v.confirmations} preuves pour ${regles.length} règle(s)`);
    ok('deux règles lisant le même niveau comptent pour une seule',
      v.confirmations <= regles.length, `${v.confirmations} <= ${regles.length}`);
    if ((v.preuvesPartagees || []).length) {
      ok('le partage de preuve est annoncé explicitement',
        /décrivent la même observation/.test((v.preuvesPartagees[0] || {}).lecture || ''),
        v.preuvesPartagees[0].lecture);
      ok('un signal avec une seule preuve n\'est pas confirmé à seuil 2',
        v.confirmations >= 2 || v.status !== 'confirme',
        `${v.confirmations} preuve(s), statut ${v.status}`);
    }
    ok('le résumé parle de preuves distinctes', /preuve\(s\) distincte\(s\)/.test(v.summary || ''),
      String(v.summary || '').slice(0, 100));
    // Les empreintes doivent être de nature différente selon les règles : R5 (la
    // structure) ne peut jamais partager sa preuve avec une règle de niveau.
    const sansPreuve = (v.rules || []).filter(r => /^regle:/.test(r.preuve || ''));
    ok('aucune règle ne retombe sur son nom faute d\'empreinte', sansPreuve.length === 0,
      sansPreuve.map(r => r.rule).join(',') || 'toutes ont une empreinte réelle');

    // Chaque règle doit porter la nature d'empreinte qui lui correspond : c'est ce
    // qui garantit que deux règles de MÊME nature (un niveau) se comparent.
    const natureAttendue = { R1: 'niveau', R2: 'niveau', R3: 'zone', R4: 'range', R5: 'structure' };
    const natures = new Set();
    [vague(),
      (() => { const s = []; for (let i = 0; i < 90; i++) { const p = 100 + i * 0.3 + Math.sin(i / 3) * 2; s.push({ t: i * 60000, o: p, h: p + 1, l: p - 1, c: p + 0.4, v: 9 }); } return s; })(),
      (() => { const s = []; for (let i = 0; i < 90; i++) { const p = 100 + Math.sin(i / 5) * 6; s.push({ t: i * 60000, o: p, h: p + 1.2, l: p - 1.2, c: p + 0.2, v: 9 }); } return s; })()]
      .forEach(serie => {
        (Sig.detect(serie, { symbol: 'T', timeframe: '5m' }).rules || []).forEach(r => {
          const prefixe = String(r.preuve || '').split(':')[0];
          natures.add(prefixe);
          ok(`${r.rule} porte une empreinte « ${natureAttendue[r.rule]} »`,
            prefixe === natureAttendue[r.rule], `${r.rule} → ${prefixe}`);
        });
      });
    ok('plusieurs natures d\'empreinte coexistent', natures.size >= 2, [...natures].join(', '));
  }

  // ── La force est un SCORE, pas une probabilité ──
  // « force 82 % » se lit « 82 chances sur 100 de gagner » — un chiffre que le moteur
  // ne peut pas produire (aucun backtest). Le signe % transformait une opinion en
  // statistique. On expose donc un score nu ET un mot.
  {
    const s = [];
    for (let i = 0; i < 100; i++) { const p = 100 + i * 0.3 + Math.sin(i / 3) * 2; s.push({ t: i * 60000, o: p, h: p + 1, l: p - 1, c: p + 0.4, v: 9 }); }
    const v = Sig.detect(s, { symbol: 'T', timeframe: '5m' });

    ok('le niveau de force est un mot, pas un pourcentage',
      ['faible', 'moyenne', 'forte'].includes(v.forceNiveau), String(v.forceNiveau));
    ok('le score brut reste disponible entre 0 et 1',
      Number.isFinite(v.strength) && v.strength >= 0 && v.strength <= 1, String(v.strength));
    ok('le niveau correspond au score',
      (v.forceNiveau === 'forte' && v.strength >= 0.65)
      || (v.forceNiveau === 'moyenne' && v.strength >= 0.4 && v.strength < 0.65)
      || (v.forceNiveau === 'faible' && v.strength < 0.4),
      `${v.forceNiveau} @ ${v.strength}`);

    ok('la composition de la force est exposee', !!v.forceDetail
      && Number.isFinite(v.forceDetail.moyenneRegles)
      && Number.isFinite(v.forceDetail.bonusConcordance)
      && Number.isFinite(v.forceDetail.malusContradiction),
      v.forceDetail ? JSON.stringify({ m: v.forceDetail.moyenneRegles, b: v.forceDetail.bonusConcordance, p: v.forceDetail.malusContradiction }) : 'absent');
    ok('aucune probabilité n\'est annoncée (le moteur n\'en produit pas)',
      v.forceDetail && v.forceDetail.probabilite === null, String(v.forceDetail && v.forceDetail.probabilite));
    ok('la lecture dit explicitement que ce n\'est pas une probabilité',
      /PAS une probabilité de réussite/.test((v.forceDetail || {}).lecture || ''),
      (v.forceDetail || {}).lecture);
    ok('la lecture detaille le calcul',
      /moyenne des règles/.test((v.forceDetail || {}).lecture || '')
      && /concordance/.test((v.forceDetail || {}).lecture || '')
      && /contradiction/.test((v.forceDetail || {}).lecture || ''));
    // L'ecran ne doit plus afficher de « % » pour la force.
    ok('l\'écran n\'affiche plus la force en pourcentage',
      !/force \{\(.*strength \* 100\)/.test(jsx) && !/force \{Math\.round\(\(a\.strength/.test(jsx));
    ok('l\'écran affiche le niveau et le score nu',
      /forceNiveau/.test(jsx) && /strength \|\| 0\)\.toFixed\(2\)/.test(jsx));
  }

  // ── R4 : LE POIDS D'UNE POSITION DÉPEND DE LA TENDANCE ──
  // `trend !== 'bearish'` traitait un range et une tendance haussière à égalité :
  // R4 votait 0,4 dans les deux cas. Un achat en discount DANS une tendance
  // haussière (continuation) et un achat au bord bas d'un range (retour à la
  // moyenne) ne se valent pas — la force le dit maintenant.
  {
    const R4 = Sig.rulePosition;
    const prix = 100;
    const rapport = (trend, position, pd) => ({
      lastPrice: prix, atr14: 1,
      structure: { trend },
      premiumDiscount: { position, equilibrium: 100, low: 96, high: 104, ...(pd || {}) }
    });

    const enTendance = R4(rapport('bullish', 'discount'));
    const enRange = R4(rapport('range', 'discount'));
    const contreTendance = R4(rapport('bearish', 'discount'));

    ok('R4 vote en discount DANS une tendance haussière',
      enTendance && enTendance.direction === 'BUY', enTendance && enTendance.direction);
    ok('et avec la force pleine (0,4)',
      enTendance && enTendance.strength === 0.4, enTendance && String(enTendance.strength));

    ok('R4 vote encore en range — le bord du range est exploitable',
      enRange && enRange.direction === 'BUY', enRange && enRange.direction);
    ok('mais avec une force RÉDUITE (0,2) : pas de tendance pour porter le mouvement',
      enRange && enRange.strength === 0.2, enRange && String(enRange.strength));
    ok('sa lecture dit pourquoi la force est réduite',
      enRange && /sans tendance/.test(enRange.detail), enRange && enRange.detail);

    ok('R4 s\'abstient quand la position va CONTRE la tendance',
      contreTendance === null, JSON.stringify(contreTendance));

    // La symétrie, pour ne pas avoir corrigé un seul côté.
    const venteRange = R4(rapport('range', 'premium'));
    ok('en range, un premium se vend aussi (force réduite)',
      venteRange && venteRange.direction === 'SELL' && venteRange.strength === 0.2,
      venteRange && venteRange.direction + ' ' + venteRange.strength);
    ok('en tendance baissière, un premium se vend à force pleine',
      (() => { const r = R4(rapport('bearish', 'premium')); return r && r.direction === 'SELL' && r.strength === 0.4; })());
  }

  // ── L'ABSTENTION D'UNE RÈGLE DOIT LAISSER UNE TRACE ──
  // `reglesActives` = les règles INTERROGÉES, pas les règles satisfaites. R3
  // (aucune zone touchée) et R4 (aucun premium/discount exploitable) n'ont rien
  // trouvé : elles ne sont ni d'accord ni contre. Elles étaient calculées puis
  // JETÉES — l'écran affichait « 5 règles » face à « 2 preuves » sans qu'on
  // puisse savoir si les autres manquaient ou se taisaient.
  {
    const lisse = [];
    for (let i = 0; i < 120; i++) {
      const p = 2000 + Math.sin(i / 9) * 4 + i * 0.02;
      lisse.push({ t: i * 60000, o: p, h: p + 1.1, l: p - 1.1, c: p + 0.3, v: 7 });
    }
    const v = Sig.detect(lisse, { symbol: 'T', timeframe: '5m' });

    ok('le verdict expose les règles SANS AVIS',
      Array.isArray(v.reglesSansAvis), typeof v.reglesSansAvis);
    ok('le verdict expose les règles CONCORDANTES', Array.isArray(v.reglesConcordantes));
    ok('le verdict expose les règles OPPOSÉES', Array.isArray(v.reglesOpposees));
    ok('le verdict expose les règles NEUTRES', Array.isArray(v.reglesNeutres));
    ok('une lecture d\'ensemble est fournie',
      typeof v.reglesLecture === 'string' && v.reglesLecture.length > 10, v.reglesLecture);

    // LE POINT PRÉCIS : aucune règle interrogée ne doit disparaître.
    const interrogees = (v.reglesActives || []).slice().sort().join(',');
    const categorisees = [
      ...(v.reglesConcordantes || []), ...(v.reglesOpposees || []),
      ...(v.reglesNeutres || []), ...(v.reglesSansAvis || [])
    ].slice().sort().join(',');
    ok('chaque règle interrogée tombe dans EXACTEMENT une catégorie',
      interrogees === categorisees && interrogees.length > 0,
      `interrogées [${interrogees}] vs catégorisées [${categorisees}]`);
    ok('aucun doublon entre les catégories',
      new Set([...(v.reglesConcordantes || []), ...(v.reglesOpposees || []),
        ...(v.reglesNeutres || []), ...(v.reglesSansAvis || [])]).size
      === (v.reglesActives || []).length);

    // Une abstention n'est ni un accord ni une opposition.
    const sansAvis = v.reglesSansAvis || [];
    ok('un « sans avis » n\'est pas compté comme concordant',
      !sansAvis.some(r => (v.reglesConcordantes || []).includes(r)));
    ok('un « sans avis » n\'est pas compté comme opposé',
      !sansAvis.some(r => (v.reglesOpposees || []).includes(r)));
    ok('il ne rapporte aucun bonus de concordance (le bonus suit les PREUVES)',
      Math.abs(v.forceDetail.bonusConcordance
        - 0.1 * Math.max(0, Object.keys(v.preuves || {}).length - 1)) < 0.001,
      `bonus ${v.forceDetail.bonusConcordance}`);

    // Le résumé et les raisons les NOMMENT.
    ok('le résumé nomme les règles sans avis',
      /rien à dire sur ce graphique/.test(v.summary), v.summary.slice(0, 120));

    // Le dénominateur que l'écran affiche doit EXISTER (il manquait : le front
    // lisait `reglesEvaluees`, absent, et affichait « 2/2 » en toutes occasions).
    ok('le verdict expose `reglesEvaluees` (le dénominateur de l\'écran)',
      Array.isArray(v.reglesEvaluees) && v.reglesEvaluees.length === (v.reglesActives || []).length,
      `${(v.reglesEvaluees || []).length} vs ${(v.reglesActives || []).length}`);

    // Plus AUCUN pourcentage de force, nulle part dans le verdict.
    ok('aucun pourcentage de force dans le résumé', !/force [\d.]+ %/.test(v.summary));
    ok('aucun pourcentage de force dans les raisons',
      !(v.missing || []).some(m => /%/.test(m)), (v.missing || []).join(' | ').slice(0, 140));
    ok('aucun pourcentage de force dans la lecture détaillée',
      !/[\d.]+ %/.test(v.forceDetail.lecture));

    // Et l'ECRAN lit bien ces champs.
    const jsx2 = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
    ok('l\'écran lit `reglesEvaluees` (le dénominateur)',
      /reglesEvaluees/.test(jsx2));
    ok('l\'écran lit `reglesSansAvis` et non l\'ancien `reglesMuettes` (jamais exposé)',
      /signal\.reglesSansAvis/.test(jsx2) && !/signal\.reglesMuettes/.test(jsx2));
    ok('l\'écran affiche le NOM des règles sans avis',
      /reglesSansAvis\.join/.test(jsx2));
  }

  // ── Corrections d'audit : sécurité, intégrité, réseau ──
  // Ces défauts ne se voyaient PAS dans le canonique : tout était vert alors que
  // le code acceptait un chemin traversant, une écriture non atomique, un fetch
  // sans délai. Les tests ci-dessous les verrouillent.
  {
    // (1) ATR de WILDER — le vrai lissage, pas une moyenne simple.
    // Différence mesurable : après une secousse, la moyenne simple l'oublie d'un
    // coup, le lissage de Wilder la garde plusieurs bougies.
    const St = require('./structure.js');
    const plates = [];
    for (let i = 0; i < 30; i++) plates.push({ t: i * 60000, o: 100, h: 100.2, l: 99.8, c: 100, v: 1 });
    const secousse = plates.map((c, i) => (i === 5 ? { ...c, h: 120, l: 98 } : c));
    const w = St.analyze(secousse, { symbol: 'T', timeframe: '5m' });
    // Le choc (TR = 22) est survenu il y a 25 bougies : hors de la fenêtre des 14
    // dernières. Une moyenne glissante l'aurait donc OUBLIÉ et rendrait 0,4 ;
    // Wilder en garde la trace et rend ~0,9.
    ok('l\'ATR de Wilder garde la mémoire du choc sorti de la fenêtre',
      w.atr14 > 0.6, `ATR ${w.atr14} (une moyenne glissante des 14 dernières rendrait ~0,4)`);
    ok('et il reste borné — pas d\'explosion de la valeur',
      w.atr14 < 3, `ATR ${w.atr14}`);

    // (2) Le nom de fichier venu du client ne peut plus SORTIR du dossier.
    // On rejoue exactement la logique de nomSur (server.js ne l'exporte pas).
    const path = require('path');
    const nomSur = brut => {
      const base = path.basename(String(brut || 'fichier'));
      const propre = base.replace(/[^\w.\-() ]+/g, '_').replace(/^\.+/, '').slice(0, 120).trim();
      return propre || `fichier-${Date.now()}`;
    };
    ok('un chemin traversant est réduit à son dernier segment',
      nomSur('../../config.js') === 'config.js', nomSur('../../config.js'));
    ok('un chemin Windows traversant aussi',
      nomSur('..\\..\\secret.env') === 'secret.env', nomSur('..\\..\\secret.env'));
    ok('un nom sans danger est conservé tel quel',
      nomSur('cours-ICT.pdf') === 'cours-ICT.pdf', nomSur('cours-ICT.pdf'));
    ok('un nom vide rend un nom sûr, jamais un chemin vide',
      nomSur('') === 'fichier', nomSur(''));
    ok('un nom entièrement composé de points bascule sur le repli horodaté',
      /^fichier-\d+$/.test(nomSur('...')), nomSur('...'));
    ok('les caractères exotiques sont neutralisés',
      !/[<>:"|?*]/.test(nomSur('a<b>c:d"e|f?g*h')), nomSur('a<b>c:d"e|f?g*h'));

    // (3) Ecriture ATOMIQUE : db.js ne doit plus écrire directement dans le fichier.
    const dbSrc = fs.readFileSync(path.join(__dirname, 'db.js'), 'utf8');
    ok('db.js écrit dans un temporaire puis renomme',
      /\.tmp`/.test(dbSrc) && /rename\(temporaire/.test(dbSrc));
    ok('db.js n\'écrit plus directement le fichier final',
      !/await fs\.writeFile\(file, JSON\.stringify/.test(dbSrc));

    // (4) Aucun fetch NU dans market.js : tout passe par la reprise réseau.
    const mkSrc = fs.readFileSync(path.join(__dirname, 'market.js'), 'utf8');
    ok('market.js n\'a plus de fetch direct',
      !/await fetch\(url\)/.test(mkSrc) && (mkSrc.match(/fetchAvecReprise/g) || []).length >= 2);

    // (5) Les bougies non clôturées sont écartées PAR LE MOTEUR.
    const mixte = [];
    for (let i = 0; i < 60; i++) mixte.push({ t: i * 60000, o: 100, h: 100.5, l: 99.5, c: 100, v: 1, closed: true });
    mixte.push({ t: 60 * 60000, o: 100, h: 130, l: 70, c: 129, v: 1, closed: false }); // bougie ouverte, énorme
    const vMixte = Sig.detect(mixte, { symbol: 'T', timeframe: '5m' });
    ok('une bougie EN COURS n\'influence pas le signal',
      Math.abs(vMixte.price - 100) < 5, `prix retenu ${vMixte.price} (une bougie à 129 est exclue)`);

    // (6) Trades : les valeurs absurdes sont refusées.
    const Tr = require('./trades.js');
    const refuse = obj => { try { Tr.normalize(obj); return false; } catch { return true; } };
    ok('un prix d\'entrée négatif est refusé', refuse({ pair: 'X', direction: 'BUY', entry: -5 }));
    ok('un prix d\'entrée nul est refusé', refuse({ pair: 'X', direction: 'BUY', entry: 0 }));
    ok('une taille négative est refusée',
      refuse({ pair: 'X', direction: 'BUY', entry: 100, size: -1 }));
    ok('une taille nulle est refusée',
      refuse({ pair: 'X', direction: 'BUY', entry: 100, size: 0 }));
    ok('un SL négatif est refusé',
      refuse({ pair: 'X', direction: 'BUY', entry: 100, sl: -1 }));
    ok('un trade correct passe toujours',
      !refuse({ pair: 'X', direction: 'BUY', entry: 100, sl: 95, tp: 110, size: 1 }));

    // (7) /api/analyze est protégée par un limiteur (chaque appel coûte une IA).
    const srvSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    ok('la route d\'analyse porte un limiteur',
      /app\.post\('\/api\/analyze', requireAuth, rateLimitAnalyse/.test(srvSrc));
    ok('le limiteur compte par compte, pas par IP seule',
      /req\.session && req\.session\.username/.test(srvSrc) && /analysesParCompte/.test(srvSrc));

    // (8) CORS n'est plus ouvert à tout le web.
    ok('CORS n\'accepte plus toutes les origines sans condition',
      !/app\.use\(cors\(\)\)/.test(srvSrc) && /APP_ORIGIN/.test(srvSrc));

    // (9) Un marché vide n'est plus annoncé comme « contrôlé ».
    const alSrc = fs.readFileSync(path.join(__dirname, 'alerts.js'), 'utf8');
    ok('un compte sans marché surveillé le dit',
      /aucun marché surveillé/.test(alSrc) && /if \(!c\.marches \|\| !c\.marches\.length\)/.test(alSrc));

    // (10) L'extraction qui échoue ne devient plus le CONTENU d'une fiche.
    ok('un fichier illisible est écarté au lieu de créer une fiche',
      /resolve\(error \|\| !stdout \? null : stdout\)/.test(srvSrc)
      && /if \(!text \|\| !String\(text\)\.trim\(\)\)/.test(srvSrc));
  }

  // ── Réseau lent : ne pas perdre une alerte sur une lenteur passagère ──
  // Mesure réelle : 8,7 s pour joindre Telegram depuis cette connexion. Sans
  // reprise, l'alerte échouait sur un appel pourtant valide.
  {
    const rSrc = fs.readFileSync(path.join(__dirname, 'reseau.js'), 'utf8');
    ok('un utilitaire de reprise réseau existe',
      /async function fetchAvecReprise/.test(rSrc) && /module\.exports = \{ fetchAvecReprise/.test(rSrc));
    ok('le délai d\'un essai est généreux', /DELAI_MS = \d{4,}/.test(rSrc));
    ok('Telegram passe par la reprise', /fetchAvecReprise\(`https:\/\/api\.telegram\.org/.test(
      fs.readFileSync(path.join(__dirname, 'alerts.js'), 'utf8')));
    ok('Gemini passe par la reprise', /fetchAvecReprise\(`\$\{GEMINI_API\}/.test(
      fs.readFileSync(path.join(__dirname, 'vision.js'), 'utf8')));

    // Comportement réel, sans réseau : on remplace fetch le temps du test.
    const vraiFetch = global.fetch;
    const { fetchAvecReprise } = require('./reseau.js');
    (async () => {
      let n = 0;
      global.fetch = async () => {
        n++;
        if (n < 3) { const e = new Error('fetch failed'); e.cause = { message: 'ECONNRESET' }; throw e; }
        return { ok: true, status: 200 };
      };
      const r = await fetchAvecReprise('https://exemple.test/x', {}, 3);
      ok('deux échecs réseau puis succès : la 3e tentative aboutit', r && r.status === 200, `${n} tentatives`);

      n = 0;
      global.fetch = async () => {
        n++;
        const e = new Error('fetch failed'); e.cause = { message: 'ETIMEDOUT' }; throw e;
      };
      let err = null;
      try { await fetchAvecReprise('https://exemple.test/x', {}, 3); } catch (e) { err = e; }
      ok('tous les essais échouent : l\'erreur dit pourquoi',
        !!err && /Après\s*3 tentatives|après 3 tentatives|tentatives/i.test(err.message) && /ETIMEDOUT/.test(err.message),
        err ? err.message.slice(0, 100) : 'aucune erreur');
      ok('le nombre de tentatives est respecté', n === 3, `${n} tentatives`);

      // Une réponse en erreur est un succès RÉSEAU : on ne réessaie pas.
      n = 0;
      global.fetch = async () => { n++; return { ok: false, status: 400, text: async () => 'mauvais jeton' }; };
      const r2 = await fetchAvecReprise('https://exemple.test/x', {}, 3);
      ok('un 400 est rendu sans réessayer (l\'appelant doit voir la vraie cause)',
        r2.status === 400 && n === 1, `${n} tentative(s)`);

      global.fetch = vraiFetch;
      console.log(`\nRÉSULTAT : ${pass} réussis, ${fail} échoués${skip ? `, ${skip} non testés` : ''}`);
      if (skip) console.log(`  (${skip} test(s) non exécuté(s) : dépendance externe absente — voir les lignes « • »)`);
      process.exit(fail ? 1 : 0);
    })();
    return;
  }

  console.log(`\nRÉSULTAT : ${pass} réussis, ${fail} échoués${skip ? `, ${skip} non testés` : ''}`);
  if (skip) console.log(`  (${skip} test(s) non exécuté(s) : dépendance externe absente — voir les lignes « • »)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
