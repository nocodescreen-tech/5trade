/**
 * 5trade — CHAT : historique persistant.
 *
 * Le chat répondait mais ne se souvenait de rien : on fermait l'onglet et la
 * conversation disparaissait. Ici chaque échange est écrit (question et
 * réponse), avec l'action exécutée, pour être relu au chargement de l'écran.
 *
 * Deux niveaux de stockage, comme le reste du dépôt : table PostgreSQL
 * `chat_messages`, sinon un fichier JSON. Aucun message n'est inventé : on
 * n'écrit que ce que l'utilisateur a envoyé et ce que le système a répondu.
 */

const fs = require('fs');
const path = require('path');
const DB = require('../core/db');
const dossiers = require('../core/dossiers');

// Surchargeables : la suite de tests ne doit JAMAIS écrire ni effacer dans la
// conversation réelle. Elle travaille sur `chat_messages_verif` et son fichier.
const TABLE = process.env.CHAT_HISTORIQUE_TABLE || 'chat_messages';
const FICHIER = process.env.CHAT_HISTORIQUE_FICHIER
  || path.join(dossiers.DATA_DIR, 'chat-historique.json');
const MAX_MEMOIRE = 500;
const scope = utilisateur => utilisateur == null ? null : (typeof utilisateur === 'string' && utilisateur.trim() && utilisateur.length <= 200 ? utilisateur : (() => { throw new Error('Identité de conversation invalide'); })());

let pret = false;

async function init() {
  const sql = DB.client();
  if (!sql) return false;
  try {
    await sql`
      create table if not exists ${sql(TABLE)} (
        id        bigserial primary key,
        utilisateur text,
        role      text not null,
        texte     text not null,
        verbe     text,
        sujet     text,
        action    jsonb,
        cree_at   timestamptz default now()
      )`;
    await sql`alter table ${sql(TABLE)} add column if not exists utilisateur text`;
    await sql`create index if not exists ${sql(TABLE + '_user_id_idx')} on ${sql(TABLE)} (utilisateur, id desc)`;
    pret = true;
    return true;
  } catch (e) {
    console.error('chat/historique init :', e.message);
    return false;
  }
}

const dispo = () => !!DB.client();
async function assurer() { if (!pret && dispo()) await init(); return pret; }

/** Repli fichier : lecture tolérante (un fichier absent n'est pas une erreur). */
function lireFichier() {
  try { return JSON.parse(fs.readFileSync(FICHIER, 'utf8')); } catch { return []; }
}
function ecrireFichier(liste) {
  try {
    fs.mkdirSync(path.dirname(FICHIER), { recursive: true });
    const tmp = `${FICHIER}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(liste, null, 1));
    fs.renameSync(tmp, FICHIER);          // écriture atomique
    return true;
  } catch (e) { console.error('chat/historique écriture :', e.message); return false; }
}

/**
 * @param {'user'|'assistant'} role
 */
async function enregistrer({ role, texte, verbe = null, sujet = null, action = null, utilisateur = null }) {
  utilisateur = scope(utilisateur);
  if (!['user','assistant'].includes(role) || !texte) return { ok: false, raison: 'role et texte requis' };
  await assurer();
  if (dispo() && pret) {
    try {
      const sql = DB.client();
      await sql`
        insert into ${sql(TABLE)} (utilisateur, role, texte, verbe, sujet, action)
        values (${utilisateur}, ${role}, ${String(texte).slice(0, 8000)}, ${verbe}, ${sujet},
          ${action ? sql.json(action) : null})`;
      return { ok: true, stockage: 'postgresql' };
    } catch (e) { return { ok:false, raison:'Écriture PostgreSQL impossible' }; }
  }
  if (dispo()) return {ok:false,raison:'Initialisation historique indisponible'};
  const liste = lireFichier();
  liste.push({
    utilisateur, role, texte: String(texte).slice(0, 8000), verbe, sujet, action,
    cree_at: new Date().toISOString()
  });
  const propres = liste.filter(m => (m.utilisateur ?? null) === utilisateur);
  const exces = new Set(propres.slice(0, Math.max(0, propres.length - MAX_MEMOIRE)));
  return { ok: ecrireFichier(liste.filter(m => !exces.has(m))), stockage: 'fichier' };
}

/** Les N derniers messages, du plus ancien au plus récent. */
async function lister({ limite = 60, utilisateur = null } = {}) {
  utilisateur = scope(utilisateur);
  const max = Math.min(300, Math.max(1, Number(limite) || 60));
  await assurer();
  if (dispo() && pret) {
    try {
      const sql = DB.client();
      const r = await sql`
        select id, role, texte, verbe, sujet, action, cree_at as "creeAt"
        from ${sql(TABLE)} where utilisateur is not distinct from ${utilisateur} order by id desc limit ${max}`;
      return r.map(x => ({ ...x, creeAt: x.creeAt })).reverse();
    } catch (e) { throw new Error('Lecture historique PostgreSQL impossible'); }
  }
  if (dispo()) throw new Error('Initialisation historique indisponible');
  return lireFichier().filter(m => (m.utilisateur ?? null) === utilisateur).slice(-max);
}

/** Effacer la conversation (action explicite de l'utilisateur). */
async function effacer({ utilisateur = null } = {}) {
  utilisateur = scope(utilisateur);
  await assurer();
  if (dispo() && pret) {
    try {
      const sql = DB.client();
      await sql`delete from ${sql(TABLE)} where utilisateur is not distinct from ${utilisateur}`;
      return { ok: true, stockage: 'postgresql' };
    } catch (e) { return {ok:false,raison:'Suppression PostgreSQL impossible'}; }
  }
  if (dispo()) return {ok:false,raison:'Initialisation historique indisponible'};
  return { ok: ecrireFichier(lireFichier().filter(m => (m.utilisateur ?? null) !== utilisateur)), stockage: 'fichier' };
}

module.exports = { init, enregistrer, lister, effacer, TABLE, FICHIER };
