/**
 * 5trade — LA LIGNE DE FEATURES, EN UN SEUL ENDROIT.
 *
 * Le problème résolu : la même donnée doit être mise en forme à DEUX endroits —
 * quand on écrit le jeu de données (`dataset.js`) et quand le modèle note un
 * signal en direct (`modele.js`). Deux mises en forme écrites séparément
 * divergent tôt ou tard, et le modèle note alors des features qui ne sont pas
 * celles avec lesquelles il a appris. Le symptôme serait silencieux : des scores
 * plausibles et faux.
 *
 * Donc : une fonction, deux appelants.
 *
 * Conventions (elles viennent de la forme RÉELLE des objets, vérifiée sur une
 * sortie de `detecterTout` — pas devinée) :
 *  - une condition est {nom, valeur, seuil, ok} ;
 *  - `carte` porte tendance / atr / prix / session / position / zones /
 *    liquidite / balayages / deplacements ; `position` et `session` sont des
 *    OBJETS (`position.zone`, `session.courante`, `session.killZone`) ;
 *  - `structureContexte.zone` est un LIBELLÉ, pas un objet avec une distance.
 */

/** Nombre de zones/liquidités/etc. : un compte, ou null si la liste manque. */
const compte = v => (Array.isArray(v) ? v.length : null);

/**
 * Met un signal sous la forme d'une ligne du jeu de données.
 * @param {object} s signal de `detecterTout`
 * @param {object|null} carte carte de marché (pour les champs de contexte)
 */
function aplatir(s, carte) {
  const c = carte || {};
  const st = s.structureContexte || null;
  const entree = Number(s.entree);
  const stop = Number(s.stop);
  const risque = Number.isFinite(entree) && Number.isFinite(stop) ? Math.abs(entree - stop) : null;

  return {
    force: Number.isFinite(s.force) ? s.force : null,
    forceAvant: s.forceDetail ? s.forceDetail.avant : null,
    ajustement: s.forceDetail ? s.forceDetail.ajustement : null,
    plafonnee: s.forceDetail ? !!s.forceDetail.plafonnee : null,
    conditions: (s.conditions || []).map(x => ({
      nom: x.nom !== undefined ? x.nom : x.libelle,
      valeur: x.valeur !== undefined ? x.valeur : null,
      seuil: x.seuil !== undefined ? x.seuil : null,
      ok: !!x.ok
    })),
    conditionsOk: (s.conditions || []).filter(x => x.ok).length,
    structure: st ? {
      alignement: st.alignement,
      position: st.position,
      ajustement: st.ajustement,
      favorables: st.favorables,
      defavorables: st.defavorables,
      zone: st.zone || null,
      lecture: st.lecture || null
    } : null,
    carte: {
      tendance: c.tendance || null,
      positionZone: c.position
        ? (typeof c.position === 'string' ? c.position : (c.position.zone || null))
        : null,
      atr: Number.isFinite(c.atr) ? c.atr : null,
      prix: Number.isFinite(c.prix) ? c.prix : null,
      session: c.session
        ? (typeof c.session === 'string' ? c.session : (c.session.courante || null))
        : null,
      killZone: c.session && typeof c.session === 'object' ? (c.session.killZone || null) : null,
      zones: compte(c.zones),
      liquidites: compte(c.liquidite),
      balayages: compte(c.balayages),
      deplacements: compte(c.deplacements),
      zoneProche: c.zoneLaPlusProche ? (c.zoneLaPlusProche.type || null) : null,
      evenement: c.evenement ? (c.evenement.type || null) : null
    },
    niveaux: {
      entree: s.entree,
      stop: s.stop,
      objectifs: s.objectifs || [],
      rr: Number.isFinite(s.rr) ? s.rr : null,
      risque,
      risquePctPrix: Number.isFinite(entree) && entree !== 0 && risque !== null
        ? +((risque / entree) * 100).toFixed(4)
        : null
    },
    sens: s.sens || null,
    id: s.id || null,
    source: s.source || null,
    nom: s.nom || null,
    strategie: s.strategie || null,
    concept: s.concept || null,
    status: s.status || null
  };
}

module.exports = { aplatir };
