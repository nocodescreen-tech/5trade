/**
 * 5trade — Mémoire persistante : EXCEPTIONS.
 *
 * Une exception est une règle "ne fais pas ça", apprise par l'expérience ou
 * enseignée par l'humain. Exemples :
 *   - "ne pas trader GBPUSD pendant BOE minutes"
 *   - "ne pas ouvrir de position EURUSD après 16:00 UTC le vendredi"
 *   - "ne pas trader XAUUSD si VIX > 30" (à tester)
 *
 * Les exceptions sont prioritaires sur la décision : si un signal déclenche
 * ET qu'une exception s'applique, le signal est refusé avec la raison.
 *
 * Source : 'humain' (chat CRUD), 'moteur' (auto-apprise après N échecs), 'news'.
 */

const DB = require('../core/db');

const TABLE = 'exceptions';

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
        titre       text not null,
        regle       jsonb not null,         -- { instrument, heure_min, heure_max, jour, regime, ... }
        raison      text,
        source      text not null,          -- 'humain' | 'moteur' | 'news'
        active      boolean default true,
        cree_at     timestamptz default now()
      )`;
    return true;
  } catch (e) {
    console.error('memoire/exceptions init :', e.message);
    return false;
  }
}

/**
 * Crée une exception.
 * @param {object} p
 * @param {string} p.titre      nom court
 * @param {object} p.regle      conditions structurées
 * @param {string} p.raison     justification lisible
 * @param {string} p.source     origine
 * @returns {Promise<{ok:boolean, id?:string}>}
 */
async function creer({ titre, regle, raison, source }) {
  if (!titre || !regle || !source) return { ok: false, raison: 'titre, regle, source requis' };
  const sql = DB.client();
  if (!sql || !(await disponible())) return { ok: false, raison: 'table exceptions indisponible' };
  const id = `exc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    await sql`
      insert into ${sql(TABLE)} (id, titre, regle, raison, source, active)
      values (${id}, ${titre}, ${sql.json(regle)}, ${raison || null}, ${source}, true)`;
    return { ok: true, id };
  } catch (e) {
    return { ok: false, raison: e.message };
  }
}

/**
 * Évalue si une exception s'applique au contexte donné.
 * @param {object} ctx   { instrument, heure_utc, jour, regime, killzone, ... }
 * @returns {Promise<{bloque:boolean, exceptions:Array}>}
 */
async function evaluer(ctx) {
  const sql = DB.client();
  if (!sql || !(await disponible())) return { bloque: false, exceptions: [] };
  try {
    const toutes = await sql`select * from ${sql(TABLE)} where active = true`;
    const applicables = [];
    for (const ex of toutes) {
      if (matchException(ex.regle, ctx)) applicables.push(ex);
    }
    return { bloque: applicables.length > 0, exceptions: applicables };
  } catch { return { bloque: false, exceptions: [] }; }
}

/**
 * Vérifie si une règle s'applique au contexte.
 * Convention : toutes les conditions de la règle doivent être vraies.
 * Si la règle ne mentionne pas un champ, c'est "indifférent" = true.
 */
function matchException(regle, ctx) {
  if (!regle || typeof regle !== 'object') return false;
  if (regle.instrument && regle.instrument !== ctx.instrument) return false;
  if (regle.jour && regle.jour !== ctx.jour) return false;
  if (regle.killzone && regle.killzone !== ctx.killzone) return false;
  if (regle.regime && regle.regime !== ctx.regime) return false;
  if (regle.heure_min !== undefined && ctx.heure_utc !== undefined) {
    if (ctx.heure_utc < regle.heure_min) return false;
  }
  if (regle.heure_max !== undefined && ctx.heure_utc !== undefined) {
    if (ctx.heure_utc > regle.heure_max) return false;
  }
  // Conditions libres : toute autre clé doit être égale
  for (const [k, v] of Object.entries(regle)) {
    if (['instrument', 'jour', 'killzone', 'regime', 'heure_min', 'heure_max'].includes(k)) continue;
    if (ctx[k] !== v) return false;
  }
  return true;
}

async function lister(filtre = {}) {
  const sql = DB.client();
  if (!sql || !(await disponible())) return [];
  try {
    return await sql`
      select * from ${sql(TABLE)}
      ${filtre.activesSeulement ? sql`where active = true` : sql``}
      order by cree_at desc`;
  } catch { return []; }
}

async function desactiver(id) {
  const sql = DB.client();
  if (!sql || !(await disponible())) return { ok: false };
  try {
    await sql`update ${sql(TABLE)} set active = false where id = ${id}`;
    return { ok: true };
  } catch (e) { return { ok: false, raison: e.message }; }
}

async function supprimer(id) {
  const sql = DB.client();
  if (!sql || !(await disponible())) return { ok: false };
  try {
    await sql`delete from ${sql(TABLE)} where id = ${id}`;
    return { ok: true };
  } catch (e) { return { ok: false, raison: e.message }; }
}

module.exports = { init, creer, evaluer, lister, desactiver, supprimer, disponible };
