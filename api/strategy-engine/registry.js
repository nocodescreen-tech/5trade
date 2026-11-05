/**
 * Strategy Engine — registre persistant des fiches de stratégie (schéma phase 2).
 *
 * Jusqu'ici le validateur existait mais personne ne conservait les fiches : une
 * trace d'évaluation ne pouvait donc pas prouver QUELLES règles avaient tourné.
 * Ce module enregistre les fiches dans `strategy_versions`, avec leur hash, et
 * refuse d'écraser une version existante par un contenu différent.
 *
 * Règle : on n'invente rien. Une stratégie qui ne déclare pas ses marchés ou ses
 * conditions est enregistrée en brouillon et signalée comme incomplète, jamais
 * complétée d'office.
 */

const crypto = require('crypto');
const DB = require('../core/db');
const { valider } = require('./strategy-contract');

const ETATS = ['brouillon', 'testee', 'validee', 'retiree'];

/** Empreinte stable d'une fiche (clés triées) : deux contenus identiques, un hash. */
function empreinte(fiche) {
  const trier = v => {
    if (Array.isArray(v)) return v.map(trier);
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce((a, k) => { a[k] = trier(v[k]); return a; }, {});
    }
    return v;
  };
  return crypto.createHash('sha256').update(JSON.stringify(trier(fiche))).digest('hex');
}

const disponible = async () => {
  const sql = DB.client();
  if (!sql) return false;
  try {
    const r = await sql`
      select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_name = 'strategy_versions'`;
    return r[0] && r[0].n === 1;
  } catch { return false; }
};

/**
 * Enregistre une fiche validée.
 * @returns {Promise<{ok:boolean, etat?:'creee'|'identique'|'conflit', raison?:string, erreurs?:string[], avertissements?:string[]}>}
 */
async function enregistrer(ficheBrute, { etat = 'brouillon' } = {}) {
  const v = valider(ficheBrute);
  if (!v.ok) return { ok: false, raison: 'fiche invalide', erreurs: v.erreurs, avertissements: v.avertissements };
  if (!ETATS.includes(etat)) return { ok: false, raison: `état inconnu « ${etat} » (attendu : ${ETATS.join(', ')})` };
  if (!(await disponible())) return { ok: false, raison: 'schéma phase 2 absent' };

  const fiche = v.fiche;
  const hash = empreinte(fiche);
  const sql = DB.client();
  try {
    const [existante] = await sql`
      select hash from strategy_versions
      where strategie_id = ${fiche.id} and version = ${fiche.version}`;
    if (existante) {
      if (existante.hash === hash) {
        return { ok: true, etat: 'identique', avertissements: v.avertissements };
      }
      // Une version publiée est immuable : on publie une nouvelle version.
      return { ok: false, etat: 'conflit',
        raison: `version ${fiche.version} déjà enregistrée avec un contenu différent : publiez une nouvelle version` };
    }
    await sql`
      insert into strategy_versions (strategie_id, version, fiche, hash, etat)
      values (${fiche.id}, ${fiche.version}, ${sql.json(fiche)}, ${hash}, ${etat})`;
    return { ok: true, etat: 'creee', avertissements: v.avertissements };
  } catch (e) {
    return { ok: false, raison: e.message.slice(0, 160) };
  }
}

/** Dernière version enregistrée d'une stratégie (la plus haute sémantiquement). */
async function derniere(strategieId) {
  const sql = DB.client();
  if (!sql) return null;
  try {
    const [l] = await sql`
      select strategie_id, version, etat, hash, fiche, cree_le
      from strategy_versions where strategie_id = ${strategieId}
      order by string_to_array(version, '.')::int[] desc limit 1`;
    return l || null;
  } catch { return null; }
}

/** Carte { strategieId: { version, etat } } de toutes les fiches enregistrées. */
async function carteVersions() {
  const sql = DB.client();
  if (!sql) return {};
  try {
    const lignes = await sql`select strategie_id, version, etat from strategy_versions`;
    const carte = {};
    for (const l of lignes) {
      const actuel = carte[l.strategie_id];
      // On garde la version la plus haute (comparaison numérique, pas alphabétique).
      if (!actuel || comparerVersions(l.version, actuel.version) > 0) {
        carte[l.strategie_id] = { version: l.version, etat: l.etat };
      }
    }
    return carte;
  } catch { return {}; }
}

/** Compare deux semver : > 0 si a est plus récente que b. */
function comparerVersions(a, b) {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  }
  return 0;
}

/** Carte { strategieId: version } des versions validées — pour les traces. */
async function versionsValidees() {
  const sql = DB.client();
  if (!sql) return {};
  try {
    const lignes = await sql`
      select strategie_id, version from strategy_versions where etat in ('testee','validee')`;
    return Object.fromEntries(lignes.map(l => [l.strategie_id, l.version]));
  } catch { return {}; }
}

/**
 * Construit une fiche à partir d'un document de la base (champ `moteur`).
 * Aucune valeur n'est inventée : ce qui n'est pas déclaré reste vide et sera
 * signalé par le validateur.
 */
function ficheDepuisDocument(doc, { version = '1.0.0' } = {}) {
  const m = (doc && doc.moteur) || {};
  const tf = Array.isArray(m.timeframes) && m.timeframes.length ? m.timeframes : [];
  return {
    id: String(doc.id || ''),
    name: String(doc.title || doc.id || ''),
    version,
    supportedMarkets: Array.isArray(m.marches) ? m.marches : (Array.isArray(m.markets) ? m.markets : []),
    supportedRegimes: Array.isArray(m.regimes) ? m.regimes : null,
    timeframes: { context: [], confirmation: [], execution: tf },
    requiredConditions: Array.isArray(m.regles) ? m.regles : [],
    optionalConditions: [],
    riskModel: {
      stopLoss: m.atrStop ? `atr x${m.atrStop}` : null,
      takeProfit: m.objectifR !== undefined ? `R ${m.objectifR}` : null
    },
    parameters: { seuilForce: m.seuilForce, seuilRegles: m.seuilRegles, style: m.style }
  };
}

/**
 * Enregistre toutes les stratégies exécutables d'une liste de documents.
 * @returns {Promise<{disponible:boolean, enregistrees:number, identiques:number,
 *                    refusees:Array<{id, raison, erreurs?}>, avertissements:object}>}
 */
async function synchroniser(documents, options = {}) {
  const rapport = { disponible: false, enregistrees: 0, identiques: 0, refusees: [], avertissements: {} };
  if (!(await disponible())) { rapport.raison = 'schéma phase 2 absent'; return rapport; }
  rapport.disponible = true;
  for (const doc of (documents || [])) {
    if (!doc || !doc.id || !doc.moteur) continue;   // documentaires : rien à exécuter
    const fiche = ficheDepuisDocument(doc, options);
    const r = await enregistrer(fiche, { etat: options.etat || 'brouillon' });
    if (r.ok && r.etat === 'creee') rapport.enregistrees++;
    else if (r.ok && r.etat === 'identique') rapport.identiques++;
    else rapport.refusees.push({ id: doc.id, raison: r.raison, erreurs: r.erreurs });
    if (r.avertissements && r.avertissements.length) rapport.avertissements[doc.id] = r.avertissements;
  }
  return rapport;
}

module.exports = {
  enregistrer, derniere, versionsValidees, carteVersions, comparerVersions, synchroniser,
  ficheDepuisDocument, empreinte, disponible, ETATS
};
