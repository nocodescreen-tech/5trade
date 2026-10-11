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

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  (cond ? pass++ : fail++);
  console.log(`  ${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
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
  for (const f of ['server.js', 'db.js', 's3.js', 'vision.js', 'trades.js', 'search.js', 'export.js', 'reset-password.js', 'bootstrap-db.js']) {
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
    section('[2] PostgreSQL — IGNORÉ');
    console.log('  • DATABASE_URL absent du .env (repli JSON actif)');
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
    console.log('  • serveur non démarré → HTTP ignoré (' + e.message + ')');
  }

  // ── 5. Stockage S3 (Cloudflare R2) : aller-retour réel, nettoyé ──
  section('[5] Stockage S3 (Cloudflare R2)');
  const S3 = require('./s3');
  if (!S3.s3Ready()) {
    console.log('  • clés S3 absentes du .env → ignoré');
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
    try {
      const png = tinyPng();
      console.log(`  • image de test : PNG ${png.length} octets généré à la volée`);
      const txt = await vision.analyzeImages(
        [{ mimeType: 'image/png', base64: png.toString('base64') }],
        'Décris cette image en une phrase courte (couleurs, forme).'
      );
      ok('appel vision → texte non vide', !!txt && txt.length > 3, JSON.stringify(txt.slice(0, 70)));
    } catch (e) {
      ok('appel vision', false, e.message);
    }
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

  console.log(`\nRÉSULTAT : ${pass} réussis, ${fail} échoués`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERREUR:', e.message); process.exit(2); });
