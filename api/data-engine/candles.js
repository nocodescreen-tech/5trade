/**
 * Data Engine — stockage des bougies historiques en PostgreSQL.
 *
 * Objectif : sortir de la cache de 299 bougies (≈ 3 jours en 15m) qui rendait
 * toute calibration malhonnête. Une fois plusieurs mois en base, on peut découper
 * entraînement / validation, mesurer un régime par instrument, et calibrer des
 * seuils autrement qu'à l'œil.
 *
 * Principes :
 *  - idempotent : (symbole, timeframe, t) est la clé, réingérer ne duplique rien ;
 *  - les contrôles de cohérence sont AUSSI dans la base (CHECK h >= l, etc.) ;
 *  - la lecture rend des bougies prêtes pour les modules du moteur (t en ms).
 */

const DB = require('../core/db');

const TABLE = 'candles';

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

/** Ne garde que les bougies exploitables (prix numériques, cohérents). */
function valides(bougies) {
  return (bougies || []).filter(b => {
    if (!b) return false;
    const [o, h, l, c] = [Number(b.o), Number(b.h), Number(b.l), Number(b.c)];
    if (![o, h, l, c].every(Number.isFinite)) return false;
    if (!Number.isFinite(Number(b.t))) return false;
    return h >= l && c >= l && c <= h && o >= l && o <= h;
  });
}

/**
 * Enregistre des bougies. Idempotent.
 * @returns {{ok:boolean, ecrites:number, ignorees:number, raison?:string}}
 */
async function enregistrer(symbole, timeframe, fournisseur, bougies) {
  if (!(await disponible())) return { ok: false, ecrites: 0, ignorees: 0, raison: 'table candles absente (npm run migrer)' };
  if (!symbole || !timeframe) return { ok: false, ecrites: 0, ignorees: 0, raison: 'symbole et timeframe requis' };

  const propres = valides(bougies);
  const ignorees = (bougies || []).length - propres.length;
  if (!propres.length) return { ok: true, ecrites: 0, ignorees };

  const sql = DB.client();
  // Par lots de 500 : au-delà, la requête devient lourde pour rien.
  let ecrites = 0;
  for (let i = 0; i < propres.length; i += 500) {
    const lot = propres.slice(i, i + 500).map(b => ({
      symbole, timeframe, t: Math.round(Number(b.t)),
      o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c),
      v: Number.isFinite(Number(b.v)) ? Number(b.v) : null,
      fournisseur: fournisseur || (b.provider || null)
    }));
    try {
      const r = await sql`
        insert into candles ${sql(lot, 'symbole', 'timeframe', 't', 'o', 'h', 'l', 'c', 'v', 'fournisseur')}
        on conflict (symbole, timeframe, t) do nothing
        returning t`;
      ecrites += r.length;
    } catch (e) {
      return { ok: false, ecrites, ignorees, raison: e.message.slice(0, 160) };
    }
  }
  return { ok: true, ecrites, ignorees };
}

/**
 * Lit une série, du plus ancien au plus récent.
 * @param {object} options { limite=5000, depuis, jusqua, clotureesSeulement=true }
 */
async function lire(symbole, timeframe, options = {}) {
  if (!(await disponible())) return [];
  const sql = DB.client();
  const limite = Math.max(1, Math.min(50000, Number(options.limite) || 5000));
  try {
    const lignes = await sql`
      select t, o, h, l, c, v, fournisseur from candles
      where symbole = ${symbole} and timeframe = ${timeframe}
        ${options.depuis ? sql`and t >= ${Number(options.depuis)}` : sql``}
        ${options.jusqua ? sql`and t <= ${Number(options.jusqua)}` : sql``}
      order by t desc limit ${limite}`;
    return lignes.reverse().map(l => ({
      t: Number(l.t), o: Number(l.o), h: Number(l.h), l: Number(l.l),
      c: Number(l.c), v: l.v === null ? null : Number(l.v),
      provider: l.fournisseur, closed: true
    }));
  } catch { return []; }
}

/**
 * Couverture : combien de bougies, de quand à quand, et combien manquantes.
 * Sert à savoir si l'on peut calibrer, pas à faire joli.
 */
async function couverture(symbole = null) {
  if (!(await disponible())) return { disponible: false, series: [] };
  const sql = DB.client();
  const TF_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
  try {
    const lignes = symbole
      ? await sql`select symbole, timeframe, count(*)::int as n, min(t) as premier, max(t) as dernier
                  from candles where symbole = ${symbole} group by symbole, timeframe`
      : await sql`select symbole, timeframe, count(*)::int as n, min(t) as premier, max(t) as dernier
                  from candles group by symbole, timeframe order by symbole, timeframe`;
    return {
      disponible: true,
      series: lignes.map(l => {
        const intervalle = TF_MS[l.timeframe] || null;
        const attendues = intervalle ? Math.floor((Number(l.dernier) - Number(l.premier)) / intervalle) + 1 : null;
        const manquantes = attendues === null ? null : Math.max(0, attendues - l.n);
        return {
          symbole: l.symbole, timeframe: l.timeframe, bougies: l.n,
          premier: Number(l.premier), dernier: Number(l.dernier),
          jours: Math.round((Number(l.dernier) - Number(l.premier)) / 86400000 * 10) / 10,
          manquantes,
          complet: manquantes === null ? null : manquantes === 0
        };
      })
    };
  } catch { return { disponible: false, series: [] }; }
}

/** Symboles et unités déjà en base — pour savoir quoi relancer. */
async function seriesDisponibles() {
  const c = await couverture();
  return c.series;
}

module.exports = { enregistrer, lire, couverture, seriesDisponibles, disponible, valides, TABLE };
