#!/usr/bin/env node
/**
 * Crée la base PostgreSQL dédiée à 5trade (instance locale réutilisée)
 * et écrit DATABASE_URL dans le .env de la plateforme.
 *
 * Utilise la même instance PostgreSQL que schoolflow (localhost:5433),
 * mais une base séparée : 5trade.
 */
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const ENV_DST = path.join(__dirname, '..', '.env');
const SRC = process.argv[2] || 'C:\\Users\\rene\\schoolflow\\.env';
const DB_NAME = process.argv[3] || '5trade';

function grab(file, key) {
  try {
    for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
      const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`));
      if (m && m[1].trim()) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
  return null;
}

let url = grab(SRC, 'DATABASE_URL');
if (!url) {
  const host = grab(SRC, 'DB_HOST'), port = grab(SRC, 'DB_PORT') || '5432';
  const user = grab(SRC, 'DB_USER'), pass = grab(SRC, 'DB_PASS');
  if (host && user && pass) url = `postgresql://${user}:${pass}@${host}:${port}/postgres`;
}
if (!url) {
  console.error('✗ Aucune connexion PostgreSQL trouvée dans', SRC);
  process.exit(1);
}

// Connexion à la base "postgres" pour créer la base cible
const admin = url.replace(/\/[^/]*$/, '/postgres');
const target = url.replace(/\/[^/]*$/, '/' + DB_NAME);

(async () => {
  const sql = postgres(admin, { onnotice: () => {} });
  try {
    const exists = await sql`select 1 from pg_database where datname = ${DB_NAME}`;
    if (!exists.length) {
      await sql.unsafe(`create database "${DB_NAME}"`);
      console.log(`✓ Base "${DB_NAME}" créée`);
    } else {
      console.log(`• Base "${DB_NAME}" déjà présente`);
    }
  } finally {
    await sql.end();
  }

  // Vérifie que la base cible est joignable
  const t = postgres(target, { onnotice: () => {} });
  await t`select 1`;
  await t.end();

  // Écrit DATABASE_URL dans le .env de 5trade
  let env = fs.existsSync(ENV_DST) ? fs.readFileSync(ENV_DST, 'utf-8') : '';
  if (/^DATABASE_URL=/m.test(env)) {
    env = env.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${target}`);
  } else {
    env = env.trimEnd() + `\n\n# Base de données (même instance que schoolflow, base dédiée)\nDATABASE_URL=${target}\n`;
  }
  fs.writeFileSync(ENV_DST, env);

  const safe = target.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@');
  console.log('✓ DATABASE_URL écrit :', safe);
  console.log('  → 5trade utilisera PostgreSQL au prochain démarrage.');
})().catch(e => {
  console.error('✗', e.message);
  process.exit(1);
});
