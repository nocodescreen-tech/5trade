/**
 * 5trade — SCÉNARIOS : registre persistant.
 *
 * Le blueprint demandait une couche « plan d'attente » : le système ne dit plus
 * « achète maintenant » mais « SI le prix atteint X ET que Y se réalise, ALORS
 * prépare un setup ». Cette couche n'existait pas — le chat répondait
 * « connecter à la table scenarios ».
 *
 * Ce module ne décide RIEN : il enregistre, liste, fait expirer. La génération
 * vit dans `generateur.js`, la confirmation dans le moteur existant.
 *
 * Stockage : table PostgreSQL `scenarios`, sinon mémoire (et on le dit).
 */

const DB = require('../core/db');

const TABLE = 'scenarios';
let memoire = [];          // repli quand PostgreSQL n'est pas disponible

async function init() {
  const sql = DB.client();
  if (!sql) return false;
  try {
    await sql`
      create table if not exists ${sql(TABLE)} (
        id            text primary key,
        instrument    text not null,
        timeframe     text,
        direction     text not null,
        niveau_entree numeric,
        stop          numeric,
        tp1           numeric,
        tp2           numeric,
        conditions    jsonb,
        preuves       jsonb,
        statut        text not null default 'en_attente',
        emis_at       timestamptz default now(),
        expire_at     timestamptz,
        motif         text
      )`;
    await sql`create index if not exists scenarios_statut_idx on ${sql(TABLE)} (statut)`;
    await sql`create index if not exists scenarios_instrument_idx on ${sql(TABLE)} (instrument)`;
    pret = true;
    return true;
  } catch (e) {
    console.error('scenarios init :', e.message);
    return false;
  }
}

const dispo = () => !!DB.client();

/**
 * Initialisation PARESSEUSE : au démarrage, la base n'est pas toujours prête au
 * moment où `init()` est appelé — la table n'était alors jamais créée et la
 * première lecture répondait « la relation scenarios n'existe pas ». On retente
 * une fois, au premier usage réel, plutôt que de dépendre du moment du boot.
 */
let pret = false;
async function assurer() {
  if (pret) return true;
  if (!DB.client()) return false;
  pret = await init();
  return pret;
}

const idNeuf = () => `scn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/**
 * Enregistre un scénario. Les niveaux doivent être des nombres RÉELS : un
 * scénario sans entrée chiffrée n'est pas un plan, c'est une intention.
 */
async function creer(scn = {}) {
  const { instrument, timeframe = null, direction, niveauEntree } = scn;
  if (!instrument) return { ok: false, raison: 'instrument requis' };
  if (direction !== 'long' && direction !== 'short') return { ok: false, raison: 'direction long|short requise' };
  if (!Number.isFinite(Number(niveauEntree))) return { ok: false, raison: 'niveau d’entrée chiffré requis' };
  if (!Number.isFinite(Number(scn.stop))) return { ok: false, raison: 'stop chiffré requis' };

  const id = scn.id || idNeuf();
  const expireAt = scn.expireAt || new Date(Date.now() + (scn.ttlMs || 3 * 3600 * 1000)).toISOString();
  const ligne = {
    id, instrument, timeframe, direction,
    niveauEntree: Number(niveauEntree),
    stop: Number(scn.stop),
    tp1: Number.isFinite(Number(scn.tp1)) ? Number(scn.tp1) : null,
    tp2: Number.isFinite(Number(scn.tp2)) ? Number(scn.tp2) : null,
    conditions: scn.conditions || [],
    preuves: scn.preuves || [],
    statut: 'en_attente',
    expireAt,
    motif: scn.motif || null
  };

  await assurer();
  if (!dispo()) {
    memoire.push({ ...ligne, emisAt: new Date().toISOString() });
    return { ok: true, id, stockage: 'memoire' };
  }
  try {
    const sql = DB.client();
    await sql`
      insert into ${sql(TABLE)}
        (id, instrument, timeframe, direction, niveau_entree, stop, tp1, tp2, conditions, preuves, expire_at, motif)
      values (${id}, ${instrument}, ${timeframe}, ${direction}, ${ligne.niveauEntree}, ${ligne.stop},
        ${ligne.tp1}, ${ligne.tp2}, ${sql.json(ligne.conditions)}, ${sql.json(ligne.preuves)},
        ${expireAt}, ${ligne.motif})`;
    return { ok: true, id, stockage: 'postgresql' };
  } catch (e) {
    return { ok: false, raison: e.message };
  }
}

/** Liste les scénarios, du plus récent au plus ancien. */
async function lister({ statut = null, instrument = null, limite = 20 } = {}) {
  const max = Math.min(100, Math.max(1, Number(limite) || 20));
  await assurer();
  if (!dispo()) {
    return memoire
      .filter(s => (!statut || s.statut === statut) && (!instrument || s.instrument === instrument))
      .slice(-max).reverse();
  }
  try {
    const sql = DB.client();
    const r = await sql`
      select id, instrument, timeframe, direction,
             niveau_entree as "niveauEntree", stop, tp1, tp2,
             conditions, preuves, statut, emis_at as "emisAt", expire_at as "expireAt", motif
      from ${sql(TABLE)}
      where (${statut}::text is null or statut = ${statut})
        and (${instrument}::text is null or instrument = ${instrument})
      order by emis_at desc
      limit ${max}`;
    return r.map(x => ({ ...x }));
  } catch (e) {
    console.error('scenarios lister :', e.message);
    return [];
  }
}

/** Change le statut (déclenché, invalidé, expiré, exécuté…). */
async function changerStatut(id, statut, motif = null) {
  if (!id || !statut) return { ok: false, raison: 'id et statut requis' };
  if (!dispo()) {
    const s = memoire.find(x => x.id === id);
    if (!s) return { ok: false, raison: 'introuvable' };
    s.statut = statut; if (motif) s.motif = motif;
    return { ok: true, stockage: 'memoire' };
  }
  try {
    const sql = DB.client();
    const r = await sql`
      update ${sql(TABLE)} set statut = ${statut}, motif = coalesce(${motif}, motif)
      where id = ${id} returning id`;
    return { ok: r.length > 0 };
  } catch (e) { return { ok: false, raison: e.message }; }
}

/**
 * Expire les scénarios dont la fenêtre est passée.
 * Un plan d'attente qui n'expire jamais n'est pas un plan : c'est un espoir.
 */
async function expirer() {
  // Un plan qui meurt doit être ANNONCÉ : l'utilisateur n'a pas à découvrir
  // dans un tableau qu'un scénario a expiré pendant qu'il regardait ailleurs.
  const annoncer = async (scn) => {
    try {
      const Flux = require('../chat-crud/flux');
      await Flux.issueScenario(scn, 'expire');
    } catch { /* une annonce ratée ne bloque jamais l'expiration */ }
  };

  if (!dispo()) {
    const maintenant = Date.now();
    let n = 0;
    const venus = [];
    for (const s of memoire) {
      if (s.statut === 'en_attente' && new Date(s.expireAt).getTime() < maintenant) {
        s.statut = 'expire'; n++; venus.push(s);
      }
    }
    for (const s of venus) await annoncer(s);
    return { ok: true, expires: n };
  }
  try {
    const sql = DB.client();
    const r = await sql`
      update ${sql(TABLE)} set statut = 'expire'
      where statut = 'en_attente' and expire_at is not null and expire_at < now()
      returning id, instrument, timeframe, direction, niveau_entree as "niveauEntree"`;
    for (const s of r) await annoncer(s);
    return { ok: true, expires: r.length };
  } catch (e) { return { ok: false, raison: e.message }; }
}

module.exports = { init, creer, lister, changerStatut, expirer, TABLE };
