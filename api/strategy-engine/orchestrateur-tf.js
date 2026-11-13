/**
 * ORCHESTRATEUR MULTI-TIMEFRAME, PAR STRATÉGIE — phase 3.
 *
 * Défaut mesuré : une SEULE confluence était calculée puis distribuée à toutes
 * les fiches. Une stratégie qui exige H1 + M15 pouvait donc être « confirmée »
 * par les unités d'une autre stratégie (H4 + M5), simplement parce qu'elles
 * figuraient dans la même liste.
 *
 * Ici, chaque fiche est évaluée sur SES unités et SES rôles :
 *   contexte       → la situation générale (le plus haut)
 *   confirmation   → le setup est-il confirmé (intermédiaire)
 *   execution      → où et quand entrer (le plus bas, l'unité de travail)
 *   surveillance   → ce qui invaliderait le setup (facultatif)
 *
 * L'ordre compte : `Signals.confluence` prend la PREMIÈRE unité comme unité de
 * travail. On lui passe donc toujours l'exécution en tête, sinon la direction
 * affichée serait celle d'un timeframe supérieur — et l'écran contredirait le
 * graphique que l'utilisateur a sous les yeux.
 */

const ORDRE_ROLES = ['execution', 'confirmation', 'contexte', 'surveillance'];

/** Durée approximative en minutes, pour classer les unités. */
function minutes(tf) {
  const t = String(tf || '').trim().toUpperCase();
  // Les unités de la plateforme s'écrivent LETTRE puis nombre (M15, H4, D1).
  // Une première version attendait le nombre en premier : `minutes('M15')`
  // valait null, aucun rôle n'était déduit, et une fiche qui déclarait
  // ['M15','H4','H1'] passait pour « sans timeframe ».
  let m = t.match(/^([MHDW])(\d+)$/);
  if (m) return Number(m[2]) * { M: 1, H: 60, D: 1440, W: 10080 }[m[1]];
  m = t.match(/^(\d+)([MHDW])$/);           // tolère aussi 15M, 4H
  if (m) return Number(m[1]) * { M: 1, H: 60, D: 1440, W: 10080 }[m[2]];
  return null;
}

/**
 * Extrait les rôles d'une fiche.
 *
 * Trois cas, dans cet ordre :
 *  1. la fiche déclare ses rôles (objet `{context, confirmation, execution}`) ;
 *  2. la fiche déclare une liste plate → on la classe par durée (le plus grand
 *     est le contexte, le plus petit l'exécution) ;
 *  3. la fiche ne dit rien → aucun rôle, et on le signale (pas de rôle inventé).
 */
function rolesDe(fiche) {
  const brut = fiche && (fiche.moteur || fiche);
  const tfs = brut && (brut.timeframes || brut.unites || brut.tfs);

  const roles = { contexte: [], confirmation: [], execution: [], surveillance: [] };

  if (tfs && !Array.isArray(tfs) && typeof tfs === 'object') {
    const prendre = v => (Array.isArray(v) ? v : (v ? [v] : [])).map(String);
    roles.contexte = prendre(tfs.context || tfs.contexte);
    roles.confirmation = prendre(tfs.confirmation);
    roles.execution = prendre(tfs.execution || tfs.entree);
    roles.surveillance = prendre(tfs.surveillance || tfs.veille);
    if (roles.contexte.length || roles.confirmation.length || roles.execution.length) {
      return { ...roles, source: 'declares' };
    }
  }

  const liste = Array.isArray(tfs) ? tfs.map(String) : [];
  const classables = liste
    .map(tf => ({ tf, min: minutes(tf) }))
    .filter(x => Number.isFinite(x.min))
    .sort((a, b) => b.min - a.min);

  if (!classables.length) {
    return { ...roles, source: 'absents', motif: 'la fiche ne déclare aucun timeframe' };
  }
  if (classables.length === 1) {
    return { ...roles, execution: [classables[0].tf], source: 'deduits' };
  }
  roles.contexte = [classables[0].tf];
  roles.execution = [classables[classables.length - 1].tf];
  roles.confirmation = classables.slice(1, -1).map(x => x.tf);
  return { ...roles, source: 'deduits' };
}

/** Liste ordonnée des unités à analyser, avec leur rôle. */
function unitesOrdonnees(fiche) {
  const roles = rolesDe(fiche);
  const sortie = [];
  for (const role of ORDRE_ROLES) {
    for (const tf of roles[role]) {
      if (!sortie.some(x => x.tf === tf)) sortie.push({ tf, role });
    }
  }
  return { unites: sortie, roles };
}

/**
 * Confluence PROPRE à une stratégie.
 *
 * @param {object} fiche     la fiche (ou un profil normalisé)
 * @param {object} deps      { chargerUnite(tf) -> Promise<verdict|null> }
 */
async function confluenceStrategie(fiche, deps = {}) {
  const { unites, roles } = unitesOrdonnees(fiche);
  if (!unites.length) {
    return { aligne: false, score: 0, direction: 'NEUTRE', detail: [], parRole: {},
      motif: 'aucun timeframe déclaré : confluence non calculable', source: roles.source };
  }
  if (typeof deps.chargerUnite !== 'function') {
    return { aligne: false, score: 0, direction: 'NEUTRE', detail: [], parRole: {},
      motif: 'aucun chargeur d’unité fourni', source: roles.source };
  }

  const parTF = [];
  for (const u of unites) {
    let verdict = null;
    let erreur = null;
    try { verdict = await deps.chargerUnite(u.tf, u.role); } catch (e) { erreur = e.message; }
    parTF.push({ tf: u.tf, role: u.role, verdict, erreur });
  }

  const exploitables = parTF.filter(x => x.verdict);
  if (!exploitables.length) {
    return { aligne: false, score: 0, direction: 'NEUTRE', detail: parTF, parRole: {},
      motif: 'aucune unité exploitable (données absentes)', source: roles.source };
  }

  const Signals = require('../engine/signals');
  // L'exécution est TOUJOURS en tête : c'est elle qui porte la direction.
  const conf = Signals.confluence(exploitables, {
    seuilAlignes: Number.isFinite(deps.seuilAlignes) ? deps.seuilAlignes : undefined
  });

  const parRole = {};
  for (const x of exploitables) {
    parRole[x.role] = parRole[x.role] || [];
    parRole[x.role].push(x.tf);
  }

  // Conflit explicite : le contexte et l'exécution ne disent pas la même chose.
  const dirRole = role => {
    const v = exploitables.filter(x => x.role === role && x.verdict.direction
      && x.verdict.direction !== 'NEUTRE');
    return v.length ? v[0].verdict.direction : null;
  };
  const dCtx = dirRole('contexte');
  const dExec = dirRole('execution') || conf.direction;
  const conflit = dCtx && dExec && dCtx !== dExec
    ? `contexte ${dCtx} contre exécution ${dExec}` : null;

  // Un contexte qui dit SELL et une exécution qui dit BUY ne sont PAS un
  // alignement, même si la majorité des unités est d'accord. Mesuré sur
  // strategy_trend : 1d SELL · 4h BUY · 1h BUY rendait `aligne: true`.
  if (conflit) {
    return {
      ...conf,
      aligne: false,
      score: 0,
      conflit,
      motif: `conflit de timeframes : ${conflit}`,
      parRole,
      source: roles.source,
      unites: unites.map(u => u.tf),
      detail: exploitables.map(x => ({ tf: x.tf, role: x.role, direction: x.verdict.direction, status: x.verdict.status }))
    };
  }

  return {
    ...conf,
    conflit,
    parRole,
    source: roles.source,
    unites: unites.map(u => u.tf),
    detail: exploitables.map(x => ({ tf: x.tf, role: x.role, direction: x.verdict.direction, status: x.verdict.status }))
  };
}

module.exports = { rolesDe, unitesOrdonnees, confluenceStrategie, minutes, ORDRE_ROLES };
