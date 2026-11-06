/**
 * Journal d'audit — la trace de ce qui a été FAIT, pas seulement de ce qui a
 * réussi.
 *
 * Règles :
 *  - aucune écriture ne lève jamais : un audit indisponible ne doit pas empêcher
 *    une connexion ou une sauvegarde de fonctionner ;
 *  - aucun secret n'y entre : jamais de mot de passe, de jeton ni de clé, même en
 *    détail. On enregistre l'action, la cible et le résultat, pas les valeurs ;
 *  - l'acteur est l'identifiant de session ou « anonyme », jamais une IP seule.
 */

const DB = require('../core/db');

const TABLE = 'audit_log';

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

/** Retire tout ce qui ressemble à un secret avant d'écrire quoi que ce soit. */
function nettoyer(detail) {
  if (!detail || typeof detail !== 'object') return null;
  const sortie = {};
  for (const [cle, valeur] of Object.entries(detail)) {
    if (/pass|mdp|secret|token|jeton|key|cle|apikey|auth/i.test(cle)) {
      sortie[cle] = '[masqué]';
      continue;
    }
    if (valeur && typeof valeur === 'object') {
      sortie[cle] = Array.isArray(valeur) ? `[${valeur.length} élément(s)]` : nettoyer(valeur);
    } else {
      sortie[cle] = typeof valeur === 'string' ? valeur.slice(0, 200) : valeur;
    }
  }
  return sortie;
}

/**
 * Enregistre une action sensible. Ne lève jamais.
 * @returns {Promise<{ok:boolean, id?:number, raison?:string}>}
 */
async function enregistrer({ acteur = null, action, cible = null, detail = null, ip = null, succes = true }) {
  try {
    if (!action) return { ok: false, raison: 'action requise' };
    if (!(await disponible())) return { ok: false, raison: 'table audit_log absente' };
    const sql = DB.client();
    const [ligne] = await sql`
      insert into audit_log (acteur, action, cible, detail, ip, succes)
      values (${acteur ? String(acteur).slice(0, 120) : null},
              ${String(action).slice(0, 80)},
              ${cible ? String(cible).slice(0, 160) : null},
              ${sql.json(nettoyer(detail) || {})},
              ${ip ? String(ip).slice(0, 60) : null},
              ${succes === true})
      returning id`;
    return { ok: true, id: ligne && ligne.id };
  } catch (e) {
    return { ok: false, raison: e.message.slice(0, 120) };
  }
}

/** Lit les dernières entrées, éventuellement filtrées par action. */
async function lister({ limite = 100, action = null } = {}) {
  if (!(await disponible())) return { disponible: false, entrees: [] };
  const sql = DB.client();
  const max = Math.max(1, Math.min(500, Number(limite) || 100));
  try {
    const entrees = action
      ? await sql`select id, at, acteur, action, cible, detail, ip, succes
                  from audit_log where action = ${action} order by id desc limit ${max}`
      : await sql`select id, at, acteur, action, cible, detail, ip, succes
                  from audit_log order by id desc limit ${max}`;
    return { disponible: true, entrees };
  } catch (e) {
    return { disponible: false, entrees: [], raison: e.message.slice(0, 120) };
  }
}

/** Compte par action sur une fenêtre — sert à voir une rafale d'échecs. */
async function resume({ heures = 24 } = {}) {
  if (!(await disponible())) return { disponible: false, actions: [] };
  const sql = DB.client();
  try {
    const lignes = await sql`
      select action, succes, count(*)::int as n
      from audit_log
      where at > now() - (${Math.max(1, Math.min(720, Number(heures) || 24))} || ' hours')::interval
      group by action, succes order by n desc`;
    return { disponible: true, actions: lignes };
  } catch (e) {
    return { disponible: false, actions: [], raison: e.message.slice(0, 120) };
  }
}

module.exports = { enregistrer, lister, resume, disponible, nettoyer, TABLE };
