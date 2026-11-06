/**
 * Traçabilité des évaluations et des signaux (schéma phase 2).
 *
 * Le journal ne conservait que des COMPTEURS de conditions (« 5/7 ») : impossible
 * de dire laquelle avait bloqué. Ce module écrit les conditions NOMMÉES et leur
 * preuve, pour répondre après coup à « pourquoi ce signal est-il sorti — ou pas ? ».
 *
 * Dégradation assumée : si la base est en mode fichiers, ou si le schéma phase 2
 * n'est pas appliqué, on renvoie { ok:false, raison } sans jamais lever. Une
 * panne de traçabilité ne doit pas arrêter la surveillance.
 */

const DB = require('../core/db');

let schemaVu = null;   // null = pas encore vérifié

/** Vrai si les tables phase 2 existent. Mémoïsé : une seule vérification. */
async function disponible() {
  if (schemaVu !== null) return schemaVu;
  const sql = DB.client();
  if (!sql) { schemaVu = false; return false; }
  try {
    const r = await sql`
      select count(*)::int as n from information_schema.tables
      where table_schema = 'public'
        and table_name in ('strategy_versions','strategy_evaluations','signal_evidence','signals')`;
    schemaVu = r[0] && r[0].n === 4;
  } catch {
    schemaVu = false;
  }
  return schemaVu;
}

/** Réinitialise le mémo (tests, ou après application du schéma à chaud). */
const oublierSchema = () => { schemaVu = null; };

/** Clé de version utilisée quand la stratégie n'est pas encore enregistrée. */
const VERSION_PAR_DEFAUT = '0.0.0';

async function assurerVersion(strategieId, version, fiche) {
  const sql = DB.client();
  if (!sql) return false;
  try {
    await sql`insert into strategy_versions (strategie_id, version, fiche, hash, etat)
              values (${strategieId}, ${version}, ${sql.json(fiche || { id: strategieId })}, ${'auto:' + strategieId}, 'brouillon')
              on conflict (strategie_id, version) do nothing`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Enregistre une évaluation et ses preuves nommées.
 *
 * @param {object} e { strategieId, version, symbole, timeframe, regime, statut,
 *                     direction, conditions, manquantes, score, dureeMs, preuves[] }
 * @returns {Promise<{ok:boolean, id?:number, raison?:string}>}
 */
async function enregistrerEvaluation(e) {
  if (!e || !e.strategieId || !e.symbole || !e.timeframe || !e.statut) {
    return { ok: false, raison: 'évaluation incomplète (stratégie, symbole, timeframe et statut requis)' };
  }
  if (!(await disponible())) return { ok: false, raison: 'schéma phase 2 absent' };

  const sql = DB.client();
  const version = String(e.version || VERSION_PAR_DEFAUT);
  await assurerVersion(e.strategieId, version, e.fiche);

  const statut = ['VALID', 'WAITING', 'INVALID', 'NO_DATA'].includes(e.statut) ? e.statut : 'WAITING';
  const direction = ['BUY', 'SELL'].includes(e.direction) ? e.direction : null;

  try {
    const [ligne] = await sql`
      insert into strategy_evaluations
        (strategie_id, version, symbole, timeframe, regime, statut, direction,
         conditions, manquantes, score, duree_ms)
      values (${e.strategieId}, ${version}, ${e.symbole}, ${e.timeframe},
              ${e.regime || null}, ${statut}, ${direction},
              ${sql.json(e.conditions || {})}, ${sql.array(e.manquantes || [])},
              ${Number.isFinite(e.score) ? e.score : null},
              ${Number.isFinite(e.dureeMs) ? Math.round(e.dureeMs) : null})
      returning id`;

    const preuves = Array.isArray(e.preuves) ? e.preuves.filter(p => p && p.condition) : [];
    if (preuves.length) {
      const lots = preuves.slice(0, 40).map(p => ({
        evaluation_id: ligne.id,
        signal_id: null,
        condition: String(p.condition).slice(0, 120),
        obligatoire: p.obligatoire === true,
        remplie: p.remplie === true,
        valeur: p.valeur === undefined ? null : p.valeur,
        detail: p.detail ? String(p.detail).slice(0, 400) : null
      }));
      await sql`insert into signal_evidence ${sql(lots, 'evaluation_id', 'signal_id',
        'condition', 'obligatoire', 'remplie', 'valeur', 'detail')}`;
    }
    return { ok: true, id: ligne.id };
  } catch (err) {
    return { ok: false, raison: err.message.slice(0, 160) };
  }
}

/**
 * Enregistre le signal publié, rattaché à son évaluation.
 * @param {object} s { evaluationId, strategieId, version, symbole, timeframe,
 *                     direction, entree, stop, objectifs, rr, statut, expireLe }
 */
async function enregistrerSignal(s) {
  if (!s || !s.evaluationId || !s.symbole || !s.timeframe || !['BUY', 'SELL'].includes(s.direction)) {
    return { ok: false, raison: 'signal incomplet (évaluation, symbole, timeframe, direction)' };
  }
  if (!(await disponible())) return { ok: false, raison: 'schéma phase 2 absent' };
  const sql = DB.client();
  try {
    // objectifs est numeric[] : un tableau JS non typé part en text[], d'où le cast.
    const [ligne] = await sql`
      insert into signals
        (evaluation_id, strategie_id, version, symbole, timeframe, direction,
         entree, stop, objectifs, rr, statut, expire_le)
      values (${s.evaluationId}, ${s.strategieId || 'inconnue'},
              ${String(s.version || VERSION_PAR_DEFAUT)}, ${s.symbole}, ${s.timeframe},
              ${s.direction},
              ${Number.isFinite(s.entree) ? s.entree : null},
              ${Number.isFinite(s.stop) ? s.stop : null},
              ${sql.array(Array.isArray(s.objectifs) ? s.objectifs.filter(Number.isFinite) : [])}::numeric[],
              ${Number.isFinite(s.rr) ? s.rr : null},
              ${s.statut || 'PUBLISHED'}, ${s.expireLe || null})
      returning id`;
    return { ok: true, id: ligne.id };
  } catch (err) {
    return { ok: false, raison: err.message.slice(0, 160) };
  }
}

/**
 * Convertit un verdict du moteur en preuves nommées.
 * Les obligations viennent de `obligatoires`/`bloquantes` ; les confirmations
 * facultatives de la checklist, qui porte déjà des libellés lisibles.
 */
function preuvesDepuisVerdict(v) {
  if (!v) return [];
  const preuves = [];
  const bloquantes = new Set(Array.isArray(v.bloquantes) ? v.bloquantes : []);
  for (const cle of (v.obligatoires || [])) {
    preuves.push({
      condition: cle,
      obligatoire: true,
      remplie: !bloquantes.has(cle),
      detail: bloquantes.has(cle) ? 'condition obligatoire non confirmée' : 'condition obligatoire confirmée'
    });
  }
  for (const c of (v.checklist || [])) {
    if (!c || !c.label) continue;
    preuves.push({
      condition: c.label,
      obligatoire: false,
      remplie: c.ok === true,
      detail: c.detail || null
    });
  }
  return preuves;
}

/**
 * Dernières évaluations avec leurs preuves nommées — lecture pour l'écran.
 * Une jointure, pas N requêtes : 20 évaluations = 1 aller-retour.
 */
async function dernieresEvaluations({ limite = 20, symbole = null } = {}) {
  if (!(await disponible())) return [];
  const sql = DB.client();
  const max = Math.max(1, Math.min(100, Number(limite) || 20));
  try {
    const evals = symbole
      ? await sql`
          select id, strategie_id, version, symbole, timeframe, regime, statut, direction, score, at
          from strategy_evaluations where symbole = ${symbole}
          order by id desc limit ${max}`
      : await sql`
          select id, strategie_id, version, symbole, timeframe, regime, statut, direction, score, at
          from strategy_evaluations order by id desc limit ${max}`;
    if (!evals.length) return [];

    const ids = evals.map(e => e.id);
    const preuves = await sql`
      select evaluation_id, condition, obligatoire, remplie, detail
      from signal_evidence where evaluation_id in ${sql(ids)}
      order by obligatoire desc, id asc`;

    const parEval = new Map();
    for (const p of preuves) {
      if (!parEval.has(p.evaluation_id)) parEval.set(p.evaluation_id, []);
      parEval.get(p.evaluation_id).push({
        condition: p.condition,
        obligatoire: p.obligatoire,
        remplie: p.remplie,
        detail: p.detail
      });
    }
    return evals.map(e => ({ ...e, preuves: parEval.get(e.id) || [] }));
  } catch {
    return [];
  }
}


/**
 * Statut EN DIRECT de chaque couple (stratégie, marché).
 *
 * Une évaluation est écrite à chaque cycle de surveillance, même quand aucun
 * signal n'est publié : c'est là que vit le statut réel (VALID, WAITING,
 * INVALID, NO_DATA). Sans cette lecture, l'utilisateur ne voit que les signaux
 * publiés et croit que le moteur ne fait rien — ou pire, que tout est bon.
 *
 * DISTINCT ON garde la plus récente par couple : une requête, pas N+1.
 */
async function statutsEnDirect({ limite = 200, fraicheurMs = 3600000 } = {}) {
  if (!(await disponible())) return { disponible: false, statuts: [] };
  const sql = DB.client();
  const max = Math.max(1, Math.min(500, Number(limite) || 200));
  try {
    const lignes = await sql`
      select distinct on (strategie_id, symbole)
        id, strategie_id, version, symbole, timeframe, statut, direction, score, at, regime
      from strategy_evaluations
      order by strategie_id, symbole, at desc, id desc
      limit ${max}`;

    if (!lignes.length) return { disponible: true, statuts: [] };

    const ids = lignes.map(l => l.id);
    const preuves = await sql`
      select evaluation_id, condition, obligatoire, remplie, detail
      from signal_evidence where evaluation_id in ${sql(ids)}
      order by obligatoire desc, id asc`;

    const parEval = new Map();
    for (const pr of preuves) {
      if (!parEval.has(pr.evaluation_id)) parEval.set(pr.evaluation_id, []);
      parEval.get(pr.evaluation_id).push({
        condition: pr.condition,
        obligatoire: pr.obligatoire === true,
        remplie: pr.remplie === true,
        detail: pr.detail
      });
    }

    const maintenant = Date.now();
    return {
      disponible: true,
      statuts: lignes.map(l => {
        const at = new Date(l.at).getTime();
        const conditions = parEval.get(l.id) || [];
        const obligatoires = conditions.filter(c => c.obligatoire);
        return {
          strategie: l.strategie_id,
          version: l.version,
          symbole: l.symbole,
          timeframe: l.timeframe,
          statut: l.statut,
          direction: l.direction,
          score: l.score === null ? null : Number(l.score),
          conditionRemplies: conditions.filter(c => c.remplie).length,
          conditionTotal: conditions.length,
          obligatoiresManquantes: obligatoires.filter(c => !c.remplie).map(c => c.condition),
          ageMs: Number.isFinite(at) ? Math.max(0, maintenant - at) : null,
          frais: Number.isFinite(at) ? (maintenant - at) <= fraicheurMs : false,
          at: l.at
        };
      })
    };
  } catch { return { disponible: false, statuts: [] }; }
}

module.exports = {
  disponible, oublierSchema, enregistrerEvaluation, enregistrerSignal,
  preuvesDepuisVerdict, dernieresEvaluations, statutsEnDirect, VERSION_PAR_DEFAUT
};
