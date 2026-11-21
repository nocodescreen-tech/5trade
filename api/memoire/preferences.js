/**
 * 5trade — Mémoire cognitive persistante : PRÉFÉRENCES & CONSIGNES PERMANENTES.
 *
 * Différence fondamentale avec `faits.js` :
 *  - Les faits sont des observations temporaires de marché qui expirent (TTL).
 *  - Les préférences et consignes utilisateur sont PERMANENTES : elles ne meurent pas
 *    après 7 jours. Exemples :
 *      - « Le Forex est fermé le samedi »
 *      - « Ne jamais risquer plus de 1 % sur l'or »
 *      - « Préviens-moi sur Telegram 30 min avant la clôture du vendredi »
 *
 * Stockage : table PostgreSQL `preferences_agent` si DB disponible, fichier JSON `data/preferences-agent.json` sinon.
 */

const fs = require('fs');
const path = require('path');
const DB = require('../core/db');

const TABLE = 'preferences_agent';
const FICHIER_REPLI = process.env.PREFERENCES_FICHIER || path.join(__dirname, '..', '..', 'data', 'preferences-agent.json');

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
  if (sql) {
    try {
      await sql`
        create table if not exists ${sql(TABLE)} (
          cle         text primary key,
          categorie   text not null default 'consigne',
          contenu     text not null,
          source      text not null default 'utilisateur',
          active      boolean default true,
          cree_at     timestamptz default now(),
          maj_at      timestamptz default now()
        )`;
      await sql`create index if not exists pref_agent_cat_idx on ${sql(TABLE)} (categorie)`;
      return true;
    } catch (e) {
      console.error('memoire/preferences init :', e.message);
    }
  }
  // Repli fichier
  try {
    if (!fs.existsSync(FICHIER_REPLI)) {
      fs.mkdirSync(path.dirname(FICHIER_REPLI), { recursive: true });
      fs.writeFileSync(FICHIER_REPLI, JSON.stringify([], null, 2));
    }
    return true;
  } catch { return false; }
}

function lireRepli() {
  try {
    if (fs.existsSync(FICHIER_REPLI)) {
      return JSON.parse(fs.readFileSync(FICHIER_REPLI, 'utf8'));
    }
  } catch {}
  return [];
}

function ecrireRepli(liste) {
  try {
    fs.mkdirSync(path.dirname(FICHIER_REPLI), { recursive: true });
    fs.writeFileSync(FICHIER_REPLI, JSON.stringify(liste, null, 2));
  } catch {}
}

/**
 * Enregistre ou met à jour une consigne permanente de l'utilisateur.
 * @param {object} p
 * @param {string} p.cle        clé unique ou identifiant de consigne
 * @param {string} p.contenu    texte explicite de la consigne
 * @param {string} [p.categorie='consigne']  'consigne'|'session'|'risque'|'strategie'
 * @param {string} [p.source='utilisateur']  'utilisateur'|'ia'|'chat'
 * @returns {Promise<{ok:boolean, cle:string}>}
 */
async function enregistrer({ cle, contenu, categorie = 'consigne', source = 'utilisateur' }) {
  if (!cle || !contenu) return { ok: false, raison: 'cle et contenu requis' };
  const sql = DB.client();
  if (sql && (await disponible())) {
    try {
      await sql`
        insert into ${sql(TABLE)} (cle, categorie, contenu, source, active, maj_at)
        values (${cle}, ${categorie}, ${contenu}, ${source}, true, now())
        on conflict (cle) do update set
          contenu = excluded.contenu,
          categorie = excluded.categorie,
          source = excluded.source,
          active = true,
          maj_at = now()`;
      return { ok: true, cle };
    } catch (e) {
      return { ok: false, raison: e.message };
    }
  }

  // Repli JSON
  const liste = lireRepli();
  const idx = liste.findIndex(x => x.cle === cle);
  const now = new Date().toISOString();
  if (idx >= 0) {
    liste[idx] = { ...liste[idx], contenu, categorie, source, active: true, maj_at: now };
  } else {
    liste.push({ cle, contenu, categorie, source, active: true, cree_at: now, maj_at: now });
  }
  ecrireRepli(liste);
  return { ok: true, cle };
}

/**
 * Liste les préférences enregistrées.
 * @param {object} [filtre]
 * @param {string} [filtre.categorie]
 * @param {boolean} [filtre.activesSeulement=true]
 */
async function lister({ categorie, activesSeulement = true } = {}) {
  const sql = DB.client();
  if (sql && (await disponible())) {
    try {
      let r = await sql`select * from ${sql(TABLE)} order by cree_at desc`;
      if (activesSeulement) r = r.filter(x => x.active === true);
      if (categorie) r = r.filter(x => x.categorie === categorie);
      return r;
    } catch { return []; }
  }

  let liste = lireRepli();
  if (activesSeulement) liste = liste.filter(x => x.active !== false);
  if (categorie) liste = liste.filter(x => x.categorie === categorie);
  return liste;
}

/**
 * Désactive une consigne.
 */
async function desactiver(cle) {
  const sql = DB.client();
  if (sql && (await disponible())) {
    try {
      await sql`update ${sql(TABLE)} set active = false, maj_at = now() where cle = ${cle}`;
      return { ok: true };
    } catch (e) { return { ok: false, raison: e.message }; }
  }
  const liste = lireRepli();
  const item = liste.find(x => x.cle === cle);
  if (item) {
    item.active = false;
    item.maj_at = new Date().toISOString();
    ecrireRepli(liste);
  }
  return { ok: true };
}

module.exports = { init, enregistrer, lister, desactiver };
