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

let pret = false;

async function init() {
  const sql = DB.client();
  if (!sql) return false;
  try {
    await sql`
      create table if not exists ${sql(TABLE)} (
        id        bigserial primary key,
        role      text not null,
        texte     text not null,
        verbe     text,
        sujet     text,
        action    jsonb,
        cree_at   timestamptz default now()
      )`;
    await sql`create index if not exists chat_messages_at_idx on ${sql(TABLE)} (cree_at desc)`;
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
    fs.writeFileSync(tmp, JSON.stringify(liste.slice(-MAX_MEMOIRE), null, 1));
    fs.renameSync(tmp, FICHIER);          // écriture atomique
    return true;
  } catch (e) { console.error('chat/historique écriture :', e.message); return false; }
}

/**
 * @param {'user'|'assistant'} role
 */
async function enregistrer({ role, texte, verbe = null, sujet = null, action = null }) {
  if (!role || !texte) return { ok: false, raison: 'role et texte requis' };
  await assurer();
  if (dispo() && pret) {
    try {
      const sql = DB.client();
      await sql`
        insert into ${sql(TABLE)} (role, texte, verbe, sujet, action)
        values (${role}, ${String(texte).slice(0, 8000)}, ${verbe}, ${sujet},
          ${action ? sql.json(action) : null})`;
      return { ok: true, stockage: 'postgresql' };
    } catch (e) { /* on bascule sur le fichier */ }
  }
  const liste = lireFichier();
  liste.push({
    role, texte: String(texte).slice(0, 8000), verbe, sujet, action,
    cree_at: new Date().toISOString()
  });
  return { ok: ecrireFichier(liste), stockage: 'fichier' };
}

/** Les N derniers messages, du plus ancien au plus récent. */
async function lister({ limite = 60 } = {}) {
  const max = Math.min(300, Math.max(1, Number(limite) || 60));
  await assurer();
  if (dispo() && pret) {
    try {
      const sql = DB.client();
      const r = await sql`
        select id, role, texte, verbe, sujet, action, cree_at as "creeAt"
        from ${sql(TABLE)} order by id desc limit ${max}`;
      return r.map(x => ({ ...x, creeAt: x.creeAt })).reverse();
    } catch (e) { /* repli */ }
  }
  return lireFichier().slice(-max);
}

/** Effacer la conversation (action explicite de l'utilisateur). */
async function effacer() {
  await assurer();
  if (dispo() && pret) {
    try {
      const sql = DB.client();
      await sql`delete from ${sql(TABLE)}`;
      return { ok: true, stockage: 'postgresql' };
    } catch (e) { /* repli */ }
  }
  return { ok: ecrireFichier([]), stockage: 'fichier' };
}

module.exports = { init, enregistrer, lister, effacer, TABLE, FICHIER };
