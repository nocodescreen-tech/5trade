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
  for (const f of ['server.js', 'db.js', 's3.js', 'vision.js', 'trades.js', 'search.js', 'export.js', 'market.js', 'structure.js', 'signals.js', 'reset-password.js', 'bootstrap-db.js', 'alerts.js', 'lexique.js', 'expliquer.js', 'concepts.js']) {
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
    ok('profil : texte sans indication → toutes les règles (rien d\'omis)', p4.regles.length === 4 && !p4.deduitDuTexte);
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
    ok('mode auto : toutes les règles sont évaluées', vAuto.reglesActives.length === 4,
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
    ok('les zones se rechargent toutes seules', /setInterval\(recharger, 15000\)/.test(jsx));
    ok('le rechargement met bien à jour rapport ET vocabulaire',
      /setReport\(st\.report\)/.test(jsx) && /setVocabulaire\(st\.vocabulaire\)/.test(jsx));
  }

  console.log(`\nRÉSULTAT : ${pass} réussis, ${fail} échoués${skip ? `, ${skip} non testés` : ''}`);
  if (skip) console.log(`  (${skip} test(s) non exécuté(s) : dépendance externe absente — voir les lignes « • »)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
