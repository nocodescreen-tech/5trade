#!/usr/bin/env node
/**
 * Applique le schéma phase 2 (api/db/schema-phase2.sql).
 *
 * ADDITIF et IDEMPOTENT : uniquement des CREATE ... IF NOT EXISTS. Rejouable sans
 * risque sur une base existante. Aucune donnée n'est lue, modifiée ou supprimée.
 *
 *   node api/db/migrer-phase2.js                 (utilise DATABASE_URL du .env)
 *   DATABASE_URL=postgres://... node ...         (base explicite)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const path = require('path');

const FICHIER = path.join(__dirname, 'schema-phase2.sql');

/** Découpe en instructions : le fichier ne contient ni fonction ni littéral avec « ; ». */
function instructions(sql) {
  return sql
    .split('\n')
    .filter(l => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
}

async function appliquer(url, { silencieux = false } = {}) {
  const cible = url || process.env.DATABASE_URL;
  if (!cible) throw new Error('DATABASE_URL absente : impossible d\'appliquer le schéma');
  const postgres = require('postgres');
  const sql = postgres(cible, { max: 1, onnotice: () => {} });
  const log = (...a) => { if (!silencieux) console.log(...a); };
  try {
    const texte = fs.readFileSync(FICHIER, 'utf8');
    const lots = instructions(texte);
    for (const instr of lots) {
      await sql.unsafe(instr);
    }
    const tables = await sql`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('instruments','market_profiles','strategy_versions',
                           'strategy_evaluations','signals','signal_evidence','backtest_results','candles')
      order by table_name`;
    const noms = tables.map(t => t.table_name);
    log(`schéma phase 2 appliqué : ${lots.length} instruction(s), ${noms.length}/8 table(s) présente(s)`);
    log('  ' + noms.join(', '));
    const manquantes = ['instruments', 'market_profiles', 'strategy_versions',
      'strategy_evaluations', 'signals', 'signal_evidence', 'backtest_results', 'candles']
      .filter(t => !noms.includes(t));
    if (manquantes.length) throw new Error(`table(s) manquante(s) après application : ${manquantes.join(', ')}`);
    return { instructions: lots.length, tables: noms };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

module.exports = { appliquer, instructions, FICHIER };

if (require.main === module) {
  appliquer().then(r => process.exit(0)).catch(e => {
    console.error('ÉCHEC :', e.message);
    process.exit(1);
  });
}
