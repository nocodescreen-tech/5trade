/**
 * 5trade — couche de persistance
 *
 * • PostgreSQL si DATABASE_URL est défini (tables auto-créées)
 * • Repli automatique sur des fichiers JSON dans data/ sinon
 *
 * Le contenu est stocké en JSONB : la forme des objets reste identique,
 * aucune requête métier n'a besoin de changer.
 */
const path = require('path');
const fs = require('fs').promises;

// Dossier du repli « fichiers JSON » : résolu par dossiers.js, qui garantit qu'il
// est inscriptible (le code peut être monté en lecture seule sur un PaaS).
const { DATA_DIR } = require('./dossiers');

let sql = null;
let usePg = false;

const FILES = {
  account:    path.join(DATA_DIR, 'account.json'),
  sessions:   path.join(DATA_DIR, 'sessions.json'),
  otp:        path.join(DATA_DIR, 'otp.json'),
  history:    path.join(DATA_DIR, 'history.json'),
  strategies: path.join(DATA_DIR, 'strategies.json'),
  trades:     path.join(DATA_DIR, 'trades.json'),
  comptes:    path.join(DATA_DIR, 'comptes.json')
};

async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf-8')); }
  catch { return fallback; }
}
async function writeJSON(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Ecriture ATOMIQUE : on ecrit d'abord a cote, puis on renomme. Un
  // fs.writeFile direct expose a deux pannes : un process tue en cours
  // d'ecriture laisse un JSON tronque (donc illisible au redemarrage), et deux
  // ecritures simultanees s'ecrasent. Le rename, lui, est atomique.
  const temporaire = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporaire, JSON.stringify(data, null, 2));
  await fs.rename(temporaire, file);
}

async function init() {
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      const postgres = require('postgres');
      sql = postgres(url, { onnotice: () => {}, max: 5 });
      await sql`select 1`;
      await sql`
        create table if not exists kv (
          key  text primary key,
          data jsonb not null
        )`;
      await sql`
        create table if not exists strategies (
          id         text primary key,
          data       jsonb not null,
          created_at timestamptz default now()
        )`;
      await sql`
        create table if not exists trades (
          id         text primary key,
          data       jsonb not null,
          created_at timestamptz default now()
        )`;
      usePg = true;
      const host = (url.match(/@([^/:]+)/) || [])[1] || '?';
      console.log(`   Stockage   : PostgreSQL (${host})`);
      await migrateFromFiles();
      return true;
    } catch (e) {
      console.error(`   Stockage   : PostgreSQL indisponible (${e.message}) → repli JSON`);
      sql = null;
      usePg = false;
    }
  }
  console.log('   Stockage   : fichiers JSON locaux (data/)');
  return false;
}

const isPg = () => usePg;

/** Importe les données JSON existantes si la base est encore vide. */
async function migrateFromFiles() {
  try {
    const rows = await sql`select key from kv limit 1`;
    const kbFiles = await fs.readdir(path.join(__dirname, '..', 'knowledge-base')).catch(() => []);
    if (rows.length && kbFiles.length) return; // base déjà alimentée

    const importKv = async (key) => {
      const existing = await sql`select 1 from kv where key = ${key}`;
      if (existing.length) return;
      const val = await readJSON(FILES[key], null);
      if (val === null) return;
      await sql`
        insert into kv (key, data) values (${key}, ${sql.json(val)})
        on conflict (key) do update set data = ${sql.json(val)}`;
      console.log(`   Migration  : ${key} importé depuis les fichiers JSON`);
    };

    for (const key of ['account', 'sessions', 'otp', 'history']) await importKv(key);

    const count = await sql`select count(*)::int as n from strategies`;
    if (count[0].n === 0) {
      let n = 0;
      for (const f of kbFiles) {
        if (!f.endsWith('.json')) continue;
        const s = await readJSON(path.join(__dirname, '..', 'knowledge-base', f), null);
        if (!s || !s.id) continue;
        await sql`
          insert into strategies (id, data) values (${s.id}, ${sql.json(s)})
          on conflict (id) do nothing`;
        n++;
      }
      if (n) console.log(`   Migration  : ${n} stratégie(s) importée(s)`);
    }
  } catch (e) {
    console.error('   Migration  : échec (' + e.message + ')');
  }
}

async function kvGet(key, fallback) {
  if (usePg) {
    const rows = await sql`select data from kv where key = ${key}`;
    return rows[0] ? rows[0].data : fallback;
  }
  return readJSON(FILES[key], fallback);
}

async function kvSet(key, value) {
  if (usePg) {
    await sql`
      insert into kv (key, data) values (${key}, ${sql.json(value)})
      on conflict (key) do update set data = ${sql.json(value)}`;
    return;
  }
  await writeJSON(FILES[key], value);
}

// ── Compte ──
const getAccount  = ()     => kvGet('account', null);
const saveAccount = (acc)  => kvSet('account', acc);

// ── Sessions ──
const loadSessions = ()    => kvGet('sessions', {});
const saveSessions = (s)   => kvSet('sessions', s);

// ── Codes OTP ──
const loadOtp = ()         => kvGet('otp', {});
const saveOtp = (store)    => kvSet('otp', store);

// ── Historique d'analyses ──
const loadHistory = ()     => kvGet('history', []);
const saveHistory = (h)    => kvSet('history', h);

// ── Comptes de trading (multi-comptes) ──
const loadComptes = ()     => kvGet('comptes', {});
const saveComptes = (c)    => kvSet('comptes', c);

// ── Base de connaissance (stratégies) ──
async function listStrategies() {
  if (usePg) {
    const rows = await sql`select data from strategies order by created_at desc`;
    return rows.map(r => r.data);
  }
  const map = await kvGet('strategies', {});
  return Object.values(map).sort((a, b) =>
    new Date(b.createdAt || b.uploadDate || 0) - new Date(a.createdAt || a.uploadDate || 0));
}

async function saveStrategyRecord(strategy) {
  if (usePg) {
    await sql`
      insert into strategies (id, data) values (${strategy.id}, ${sql.json(strategy)})
      on conflict (id) do update set data = ${sql.json(strategy)}`;
    return strategy;
  }
  const map = await kvGet('strategies', {});
  map[strategy.id] = strategy;
  await kvSet('strategies', map);
  return strategy;
}

async function removeStrategyRecord(id) {
  if (usePg) {
    await sql`delete from strategies where id = ${id}`;
    return true;
  }
  const map = await kvGet('strategies', {});
  delete map[id];
  await kvSet('strategies', map);
  return true;
}

// ── Journal de trades ──
async function listTrades() {
  if (usePg) {
    const rows = await sql`select data from trades order by created_at desc`;
    return rows.map(r => r.data);
  }
  const map = await kvGet('trades', {});
  return Object.values(map).sort((a, b) =>
    new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

async function saveTradeRecord(trade) {
  if (usePg) {
    await sql`
      insert into trades (id, data) values (${trade.id}, ${sql.json(trade)})
      on conflict (id) do update set data = ${sql.json(trade)}`;
    return trade;
  }
  const map = await kvGet('trades', {});
  map[trade.id] = trade;
  await kvSet('trades', map);
  return trade;
}

async function removeTradeRecord(id) {
  if (usePg) {
    await sql`delete from trades where id = ${id}`;
    return true;
  }
  const map = await kvGet('trades', {});
  delete map[id];
  await kvSet('trades', map);
  return true;
}

/**
 * Sonde de santé : prouve que la couche de stockage est réellement joignable.
 * Un /health qui répond 200 sans toucher la base ment (service « en ligne » dont
 * chaque requête échoue). En mode fichiers, on vérifie l'écriture du dossier.
 */
async function ping() {
  if (usePg) {
    await sql`select 1`;
    return 'postgresql';
  }
  await fs.access(DATA_DIR, fs.constants.W_OK);
  return 'fichiers-json';
}

module.exports = {
  init, isPg, ping,
  getAccount, saveAccount,
  loadSessions, saveSessions,
  loadOtp, saveOtp,
  loadHistory, saveHistory,
  loadComptes, saveComptes,
  listStrategies, saveStrategyRecord, removeStrategyRecord,
  listTrades, saveTradeRecord, removeTradeRecord,
  DATA_DIR
};
