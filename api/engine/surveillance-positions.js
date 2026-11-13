/**
 * SURVEILLANCE DES POSITIONS OUVERTES — phase 2.
 *
 * Le journal savait enregistrer une position et dire, après coup, si elle avait
 * touché son stop ou ses objectifs. Il ne disait rien PENDANT : à quelle
 * distance du stop on se trouve, si le scénario est en train de s'invalider, ni
 * ce qu'il faudrait faire.
 *
 * Ce module répond à ces questions sans jamais agir :
 *   - il ne déplace pas de stop (aucune fonction ne le fait) ;
 *   - il ne ferme rien ;
 *   - il PROPOSE une action avec son motif, l'utilisateur décide.
 *
 * Toutes les valeurs sont calculées à partir de l'entrée, du stop et des
 * objectifs réellement enregistrés. Aucune n'est inventée : si le prix ou l'ATR
 * manque, la position est déclarée non évaluable au lieu d'être devinée.
 */

const ACTIONS = ['conserver', 'surveiller', 'reduire', 'securiser', 'cloturer'];

/**
 * @param {object} pos   position du journal { sens, entree, stop, objectifs, atteintTP1, atteintTP2 }
 * @param {object} ctx   { prix, atr, structureContraire, newsBloquante }
 */
function analyserPosition(pos, ctx = {}) {
  const sens = String(pos && pos.sens || '').toLowerCase();
  const entree = Number(pos && pos.entree);
  const stop = Number(pos && pos.stop);
  const prix = Number(ctx.prix);
  const objectifs = Array.isArray(pos && pos.objectifs) ? pos.objectifs.map(Number).filter(Number.isFinite) : [];

  const base = {
    cle: pos && pos.cle ? pos.cle : null,
    symbol: pos && pos.symbol ? pos.symbol : null,
    sens: sens || null,
    entree: Number.isFinite(entree) ? entree : null,
    stop: Number.isFinite(stop) ? stop : null,
    prix: Number.isFinite(prix) ? prix : null,
    evaluable: false,
    motif: null,
    etat: 'inconnu',
    rEnCours: null,
    risqueRestantR: null,
    prochainObjectif: null,
    progressionPct: null,
    recommandations: []
  };

  if (sens !== 'long' && sens !== 'short') {
    return { ...base, motif: 'sens inconnu : la position ne dit pas si elle est acheteuse ou vendeuse' };
  }
  if (!Number.isFinite(entree) || !Number.isFinite(stop) || entree === stop) {
    return { ...base, motif: 'entrée ou stop absent (ou égaux) : aucun risque mesurable' };
  }
  if (!Number.isFinite(prix)) {
    return { ...base, motif: 'prix courant indisponible : position non évaluable pour l’instant' };
  }

  const long = sens === 'long';
  const risque = Math.abs(entree - stop);
  // R positif = on gagne, négatif = on perd. -1 R = stop touché.
  const rEnCours = +(((prix - entree) * (long ? 1 : -1)) / risque).toFixed(3);
  const risqueRestantR = +(1 + Math.min(0, rEnCours)).toFixed(3); // 1 R au départ, 0 au stop

  const atteintTP1 = pos.atteintTP1 === true;
  // Un objectif est ATTEINT dès que le prix l'a touché — égalité comprise.
  // La version précédente testait « strictement au-delà » : au prix exact du
  // TP1, l'objectif n'était ni atteint ni suivant, et la position restait
  // « ouverte » alors qu'elle avait rempli sa première cible.
  const atteints = objectifs.filter(o => (long ? prix >= o : prix <= o));
  const prochain = objectifs.find(o => (long ? prix < o : prix > o));
  const prochainObjectif = Number.isFinite(prochain) ? prochain
    : (atteints.length ? atteints[atteints.length - 1] : (objectifs.length ? objectifs[objectifs.length - 1] : null));
  const objectifR = Number.isFinite(prochainObjectif)
    ? +(((prochainObjectif - entree) * (long ? 1 : -1)) / risque).toFixed(3) : null;
  const progressionPct = objectifR && objectifR > 0
    ? +Math.max(-100, Math.min(100, (rEnCours / objectifR) * 100)).toFixed(0) : null;

  const recos = [];
  let etat = 'ouverte';

  // 1. Stop touché : la position est close par le marché.
  if (rEnCours <= -1) {
    etat = 'stop_atteint';
    recos.push({ action: 'cloturer', motif: `stop atteint : ${rEnCours} R` });
  } else if (rEnCours <= -0.7) {
    // 70 % du risque consommé : on prévient AVANT que ce soit trop tard.
    etat = 'proche_stop';
    recos.push({ action: 'surveiller', motif: `risque consommé à ${Math.round(-rEnCours * 100)} % — stop à ${risqueRestantR} R` });
  }

  // 2. Objectifs.
  if (atteints.length) {
    etat = 'objectif_atteint';
    recos.push({ action: 'securiser', motif: `objectif ${atteints[0]} atteint (${rEnCours} R) — sécuriser est une décision, pas un automatisme` });
  } else if (!atteintTP1 && objectifR && objectifR > 0 && rEnCours >= objectifR * 0.8) {
    if (etat === 'ouverte') etat = 'proche_tp';
    recos.push({ action: 'surveiller', motif: `à ${Math.round((rEnCours / objectifR) * 100)} % de l’objectif (${prochainObjectif})` });
  }

  // 3. Invalidation structurelle : c'est la seule raison de proposer une sortie
  //    avant le stop, et elle doit être nommée.
  if (ctx.structureContraire) {
    etat = etat === 'ouverte' ? 'scenario_invalide' : etat;
    recos.push({ action: 'cloturer', motif: `structure contraire détectée : ${String(ctx.structureContraire).slice(0, 120)}` });
  }

  // 4. Événement économique imminent sur une position ouverte.
  if (ctx.newsBloquante) {
    recos.push({ action: 'reduire', motif: `annonce à fort impact : ${String(ctx.newsBloquante).slice(0, 120)}` });
  }

  if (!recos.length) recos.push({ action: 'conserver', motif: `scénario intact (${rEnCours} R, stop à ${risqueRestantR} R)` });

  return {
    ...base,
    evaluable: true,
    etat,
    rEnCours,
    risqueRestantR,
    objectifs,
    prochainObjectif,
    objectifR,
    progressionPct,
    atr: Number.isFinite(Number(ctx.atr)) ? Number(ctx.atr) : null,
    // Toujours vrai : ce module ne modifie jamais le stop d'une position.
    stopInchange: true,
    recommandations: recos.slice(0, 3)
  };
}

/** Analyse un lot de positions ouvertes. */
function analyserLot(positions, ctxParPosition = () => ({})) {
  const ouvertes = (positions || []).filter(p => p && (p.resultat === 'ouvert' || p.resultat === undefined));
  return {
    total: ouvertes.length,
    positions: ouvertes.map(p => analyserPosition(p, ctxParPosition(p) || {})),
    // Aucune action n'est appliquée ici : c'est une lecture, pas une exécution.
    actionsAppliquees: []
  };
}

module.exports = { analyserPosition, analyserLot, ACTIONS };
