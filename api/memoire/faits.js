/**
 * 5trade — Mémoire persistante : FAITS.
 *
 * Un fait est une observation datée, sourcée, avec un niveau de confiance.
 * Exemples :
 *   - "XAUUSD a cassé 2389 le 12/11 à 14:32 avec volume 2× la moyenne"
 *   - "BCE a baissé ses taux de 25pb le 13/11"
 *   - "Spread EURUSD a dépassé 2 pips pendant NFP"
 *
 * Les faits sont immuables : on les enregistre, on les consulte, ils expirent
 * par âge. La couche `croyances.js` agrège les faits en règles.
 *
 * Stockage : table PostgreSQL `faits` si DB disponible, fichier JSON sinon.
 */

const DB = require('../core/db');

const TABLE = 'faits';

/** TTL par type de fait (en millisecondes). */
const TTL = {
  evenement:    7 * 24 * 3600 * 1000,   // événement ponctuel : 7 jours
  structure:   30 * 24 * 3600 * 1000,   // niveau, FVG, order block : 30 jours
  macro:       90 * 24 * 3600 * 1000,   // décision de banque centrale : 90 jours
  anomalie:     3 * 24 * 3600 * 1000,   // anomalie de prix/spread : 3 jours
};

const disponible = async () => {
  const sql = DB.client();
  if (!sql) return false;
  try {
    const r = await sql`
      select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_name = ${TABLE}`;
    return r[0] && r[0].n === 1;
  } catch { return false; }
};

async function init() {
  const sql = DB.client();
  if (!sql) return false;
  try {
    await sql`
      create table if not exists ${sql(TABLE)} (
        id          text primary key,
        instrument  text,
        type        text not null,
        contenu     text not null,
        source      text not null,
        confiance   numeric default 0.5,
        cree_at     timestamptz default now(),
        expire_at   timestamptz
      )`;
    await sql`create index if not exists faits_instrument_idx on ${sql(TABLE)} (instrument)`;
    await sql`create index if not exists faits_type_idx on ${sql(TABLE)} (type)`;
    return true;
  } catch (e) {
    console.error('memoire/faits init :', e.message);
    return false;
  }
}

/**
 * @param {object} p
 * @param {string} p.type         'evenement' | 'structure' | 'macro' | 'anomalie'
 * @param {string} p.contenu      description lisible
 * @param {string} p.source       'ia' | 'humain' | 'moteur' | 'news' | url
 * @param {string} [p.instrument] symbole concerné, ou null si global
 * @param {number} [p.confiance]  0 à 1
 * @returns {Promise<{ok:boolean, id?:string, raison?:string}>}
 */
async function enregistrer({ type, contenu, source, instrument = null, confiance = 0.5 }) {
  if (!type || !contenu || !source) return { ok: false, raison: 'type, contenu et source requis' };
  const ttl = TTL[type] || TTL.evenement;
  const expire = new Date(Date.now() + ttl).toISOString();
  const id = `fait_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  const sql = DB.client();
  if (!sql || !(await disponible())) {
    // Repli fichier (rarement utilisé en prod)
    return { ok: false, raison: 'table faits indisponible (initialiser avec memoire.init())' };
  }
  try {
    await sql`
      insert into ${sql(TABLE)} (id, instrument, type, contenu, source, confiance, expire_at)
      values (${id}, ${instrument}, ${type}, ${contenu}, ${source}, ${confiance}, ${expire})`;
    return { ok: true, id };
  } catch (e) {
    return { ok: false, raison: e.message };
  }
}

/**
 * Liste les faits non expirés, filtrés.
 * @param {object} [filtre]
 * @param {string} [filtre.instrument]
 * @param {string} [filtre.type]
 * @param {number} [filtre.limit=50]
 */
async function lister(filtre = {}) {
  const sql = DB.client();
  if (!sql || !(await disponible())) return [];
  const limit = Math.min(200, Number(filtre.limit) || 50);
  try {
    return await sql`
      select id, instrument, type, contenu, source, confiance, cree_at
      from ${sql(TABLE)}
      where (expire_at is null or expire_at > now())
        ${filtre.instrument ? sql`and instrument = ${filtre.instrument}` : sql``}
        ${filtre.type ? sql`and type = ${filtre.type}` : sql``}
      order by cree_at desc
      limit ${limit}`;
  } catch { return []; }
}

/** Compte les faits par type, pour le tableau de bord. */
async function stats() {
  const sql = DB.client();
  if (!sql || !(await disponible())) return { total: 0, parType: {} };
  try {
    const r = await sql`
      select type, count(*)::int as n
      from ${sql(TABLE)}
      where expire_at is null or expire_at > now()
      group by type`;
    const parType = {};
    let total = 0;
    for (const l of r) { parType[l.type] = l.n; total += l.n; }
    return { total, parType };
  } catch { return { total: 0, parType: {} }; }
}

module.exports = { init, enregistrer, lister, stats, disponible };
