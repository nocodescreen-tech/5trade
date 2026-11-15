/**
 * 5trade — Mémoire persistante : CROYANCES.
 *
 * Une croyance est une règle apprise, agrégée à partir de faits et de trades.
 * Exemple : "en killzone London, les setups POC+pin bar M5 sur XAUUSD
 * ont 41% de réussite et +0.31R d'expectancy".
 *
 * Chaque croyance a :
 *   - un contexte (régime × killzone × setup × instrument)
 *   - un compteur de confirmations et d'invalidations
 *   - un niveau de confiance (0 à 1) qui décroît si invalidations
 *   - une date de dernière observation
 *
 * Rétrogradation : si pas de confirmation depuis 14j, confiance ×= 0.8.
 * Suppression : si 3 invalidations consécutives OU confiance < 0.1.
 */

const DB = require('../core/db');

const TABLE = 'croyances';

const SEUIL_SUPPRESSION = 0.1;
const SEUIL_RETROGRADATION = 14 * 24 * 3600 * 1000;  // 14 jours sans confirmation
const FACTEUR_RETROGRADATION = 0.8;

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
        id              text primary key,
        contexte        jsonb not null,        -- { regime, killzone, setup, instrument }
        description     text not null,
        confirmations   integer default 0,
        invalidations   integer default 0,
        trades          integer default 0,
        expectancy      numeric default 0,
        confiance       numeric default 0.5,
        cree_at         timestamptz default now(),
        derniere_obs    timestamptz default now()
      )`;
    await sql`create index if not exists croyances_contexte_idx on ${sql(TABLE)} (contexte)`;
    return true;
  } catch (e) {
    console.error('memoire/croyances init :', e.message);
    return false;
  }
}

function cleContexte(ctx) {
  return [ctx.regime || '?', ctx.killzone || '?', ctx.setup || '?',
    ctx.instrument || '?'].join('|');
}

/**
 * Trouve une croyance existante pour ce contexte.
 */
async function trouver(ctx) {
  const sql = DB.client();
  if (!sql || !(await disponible())) return null;
  const cle = cleContexte(ctx);
  try {
    const r = await sql`
      select * from ${sql(TABLE)}
      where contexte->>'cle' = ${cle}
      order by derniere_obs desc limit 1`;
    return r[0] || null;
  } catch { return null; }
}

/**
 * Enregistre ou met à jour une croyance après un trade.
 * @param {object} ctx      { regime, killzone, setup, instrument }
 * @param {string} desc     description lisible
 * @param {boolean} positif true si trade gagnant
 * @param {number} r        R réalisé
 */
async function observer(ctx, desc, positif, r) {
  const sql = DB.client();
  if (!sql || !(await disponible())) return { ok: false };

  const cle = cleContexte(ctx);
  const existante = await trouver(ctx);
  const maintenant = new Date();

  try {
    if (existante) {
      const nouvConf = Math.max(0.05, Math.min(1,
        existante.confiance + (positif ? 0.05 : -0.10)));
      const nouvTrades = existante.trades + 1;
      const nouvExp = ((existante.expectancy * existante.trades) + r) / nouvTrades;
      const nouvConfCount = existante.confirmations + (positif ? 1 : 0);
      const nouvInvCount = existante.invalidations + (positif ? 0 : 1);

      // Suppression si confiance trop basse
      if (nouvConf < SEUIL_SUPPRESSION) {
        await sql`delete from ${sql(TABLE)} where id = ${existante.id}`;
        return { ok: true, action: 'supprime', raison: 'confiance < 0.1' };
      }
      await sql`
        update ${sql(TABLE)} set
          confirmations = ${nouvConfCount},
          invalidations = ${nouvInvCount},
          trades = ${nouvTrades},
          expectancy = ${+nouvExp.toFixed(4)},
          confiance = ${+nouvConf.toFixed(2)},
          derniere_obs = ${maintenant.toISOString()}
        where id = ${existante.id}`;
      return { ok: true, action: 'mis_a_jour', confiance: +nouvConf.toFixed(2) };
    }
    // Nouvelle croyance
    const id = `croy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const confiance0 = positif ? 0.55 : 0.45;
    await sql`
      insert into ${sql(TABLE)} (id, contexte, description, confirmations, invalidations,
        trades, expectancy, confiance, derniere_obs)
      values (${id}, ${sql.json({ ...ctx, cle })}, ${desc},
        ${positif ? 1 : 0}, ${positif ? 0 : 1}, 1, ${+r.toFixed(4)}, ${confiance0},
        ${maintenant.toISOString()})`;
    return { ok: true, action: 'cree', id };
  } catch (e) {
    return { ok: false, raison: e.message };
  }
}

/**
 * Rétrograde les croyances sans observation depuis 14j. À appeler une fois
 * par jour par la boucle d'apprentissage.
 */
async function retrograderAnciennes() {
  const sql = DB.client();
  if (!sql || !(await disponible())) return 0;
  try {
    const r = await sql`
      update ${sql(TABLE)} set confiance = confiance * ${FACTEUR_RETROGRADATION}
      where derniere_obs < now() - interval '${SEUIL_RETROGRADATION / 86400000} days'
        and confiance > ${SEUIL_SUPPRESSION}`;
    return r.count || 0;
  } catch { return 0; }
}

/**
 * Liste les croyances, triées par confiance décroissante.
 */
async function lister(filtre = {}) {
  const sql = DB.client();
  if (!sql || !(await disponible())) return [];
  const limit = Math.min(200, Number(filtre.limit) || 50);
  try {
    return await sql`
      select id, contexte, description, confirmations, invalidations, trades,
             expectancy, confiance, derniere_obs
      from ${sql(TABLE)}
      where confiance >= ${filtre.confianceMin || 0.1}
      order by confiance desc, trades desc
      limit ${limit}`;
  } catch { return []; }
}

/**
 * Tag de compétence : pour un contexte donné, dit si le système "sait",
 * "est moyen", ou "ne sait pas".
 */
async function niveauCompetence(ctx) {
  const c = await trouver(ctx);
  if (!c) return { niveau: 'inconnu', raison: 'aucun trade sur ce contexte' };
  if (c.trades < 5) return { niveau: 'inconnu', raison: `seulement ${c.trades} trade(s)` };
  if (c.confiance >= 0.6 && Number(c.expectancy) > 0.15)
    return { niveau: 'competent', trades: c.trades, expectancy: Number(c.expectancy) };
  if (c.confiance < 0.3 || Number(c.expectancy) < 0)
    return { niveau: 'incompetent', trades: c.trades, expectancy: Number(c.expectancy) };
  return { niveau: 'moyen', trades: c.trades, expectancy: Number(c.expectancy) };
}

module.exports = { init, observer, trouver, lister, retrograderAnciennes, niveauCompetence, disponible };
