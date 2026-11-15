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

// ── Plan de gestion (couche L6) ──────────────────────────────────────────────
// Le suivi disait « sécuriser » sans jamais dire QUOI sécuriser, ni à quel prix.
// Un trader pro ne dit pas « sécurise » : il dit « TP1 touché, ferme 50 %, mets
// le stop à l'entrée, laisse courir avec un trailing de 1,5 ATR ». C'est ce que
// ce plan chiffre, à partir de l'entrée, du stop, des objectifs et de l'ATR
// réellement enregistrés. Rien n'est appliqué : ce sont des consignes chiffrées.
const HEURE_MS = 3600 * 1000;
const LIMITE_INVALIDATION_H = 3;        // au-delà, le plan n'est plus daté
const PARTIELS = [                      // TP1 50 %, TP2 30 %, runner 20 %
  { niveau: 'TP1', pct: 50 },
  { niveau: 'TP2', pct: 30 }
];
const PCT_RUNNER = 20;
const TRAILING_ATR = 1.5;

/** Le stop le plus serré des deux — un stop ne recule jamais. */
function plusSerre(long, a, b) {
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  return long ? Math.max(a, b) : Math.min(a, b);
}
const arrondi = (x) => (Number.isFinite(x) ? +Number(x).toFixed(5) : null);

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
    timeframe: pos && pos.timeframe ? pos.timeframe : null,
    // D'OÙ VIENT CETTE POSITION : une stratégie enregistrée, un motif
    // structurel (breaker, FVG) ou un pattern graphique. Sans cette ligne, on ne
    // peut pas répondre à « quelle stratégie a produit ce trade ? ».
    nom: pos && pos.nom ? pos.nom : null,
    strategie: pos && pos.strategie ? pos.strategie : null,
    concept: pos && pos.concept ? pos.concept : null,
    source: pos && pos.source ? pos.source : null,
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

  // ── 5. Plan de gestion chiffré (couche L6) ──────────────────────────────
  // Tout est calculé à partir de l'entrée, du stop, des objectifs et de l'ATR
  // enregistrés. Ce qui manque est dit manquant : jamais deviné.
  const rDe = (o) => +(((o - entree) * (long ? 1 : -1)) / risque).toFixed(3);
  const tp1 = objectifs[0];
  const tp2 = objectifs[1];
  const tp1Atteint = Number.isFinite(tp1) && (long ? prix >= tp1 : prix <= tp1);
  const tp2Atteint = Number.isFinite(tp2) && (long ? prix >= tp2 : prix <= tp2);

  // Partiels : chaque niveau avec sa part et son R. Un niveau absent n'invente
  // pas de ligne.
  const partiels = [];
  objectifs.slice(0, 2).forEach((o, i) => partiels.push({
    niveau: PARTIELS[i].niveau,
    pct: PARTIELS[i].pct,
    prix: arrondi(o),
    r: rDe(o),
    atteint: long ? prix >= o : prix <= o
  }));
  if (objectifs.length > 2) {
    partiels.push({ niveau: 'runner', pct: PCT_RUNNER, prix: null,
      r: null, atteint: false, note: 'laissé courir sous trailing' });
  }

  // Stop cible : breakeven dès TP1, trailing 1,5 ATR dès TP2 — et le plus serré
  // gagne, parce qu'un stop ne recule jamais.
  let stopCible = null;
  let motifStop = null;
  const atr = Number.isFinite(Number(ctx.atr)) ? Number(ctx.atr) : null;
  if (tp2Atteint && atr > 0) {
    const trail = long ? prix - TRAILING_ATR * atr : prix + TRAILING_ATR * atr;
    stopCible = plusSerre(long, plusSerre(long, trail, entree), stop);
    motifStop = `TP2 atteint : trailing à ${TRAILING_ATR} ATR (${arrondi(atr)})`;
  } else if (tp1Atteint) {
    stopCible = plusSerre(long, entree, stop);
    motifStop = 'TP1 atteint : stop à l’entrée (breakeven)';
  } else {
    motifStop = 'TP1 pas encore atteint : le stop reste où il est';
  }
  if (stopCible !== null) {
    stopCible = arrondi(stopCible);
    if (stopCible === arrondi(stop)) {
      motifStop += ' — déjà en place';
    } else {
      recos.push({ action: tp2Atteint ? 'surveiller' : 'securiser',
        motif: `stop à déplacer de ${arrondi(stop)} à ${stopCible} (${motifStop})` });
    }
  }

  if (partiels.some(p => p.atteint)) {
    // Le niveau le PLUS AVANCÉ déjà touché : à TP2, annoncer encore « fermer
    // 50 % au TP1 » ferait prendre la mauvaise part.
    const atteints = partiels.filter(x => x.atteint);
    const p = atteints[atteints.length - 1];
    recos.push({ action: 'reduire',
      motif: `${p.niveau} atteint à ${p.prix} (${p.r} R) : fermer ${p.pct} % de la position` });
  }

  // Invalidation temporelle : un plan est daté. Au-delà de 3 h sans TP1, la
  // position n'est plus justifiée par le scénario qui l'a fait naître.
  const debut = Number(pos.at || pos.enregistreAt) || null;
  const maintenant = Number(ctx.maintenant) || Date.now();
  let invalidationTemporelle = null;
  if (!debut) {
    invalidationTemporelle = { limiteHeures: LIMITE_INVALIDATION_H, ageHeures: null,
      depassee: false, action: 'inconnue', motif: 'aucune date d’ouverture enregistrée : âge inconnu' };
  } else if (tp1Atteint) {
    invalidationTemporelle = { limiteHeures: LIMITE_INVALIDATION_H,
      ageHeures: +((maintenant - debut) / HEURE_MS).toFixed(2),
      depassee: false, action: 'sans objet', motif: 'TP1 atteint : le plan a produit son résultat' };
  } else {
    const ageH = +((maintenant - debut) / HEURE_MS).toFixed(2);
    const depassee = ageH >= LIMITE_INVALIDATION_H;
    invalidationTemporelle = { limiteHeures: LIMITE_INVALIDATION_H, ageHeures: ageH,
      depassee, action: depassee ? 'cloturer' : 'attendre',
      motif: depassee
        ? `ouverte depuis ${ageH} h sans atteindre TP1 : le scénario n’a plus de date`
        : `${ageH} h écoulées sur ${LIMITE_INVALIDATION_H} h autorisées` };
    if (depassee) {
      recos.push({ action: 'cloturer',
        motif: invalidationTemporelle.motif });
    }
  }

  const plan = {
    stopActuel: arrondi(stop),
    stopCible,
    motifStop,
    partiels,
    invalidationTemporelle,
    trailing: tp2Atteint && atr > 0 ? { multipleAtr: TRAILING_ATR, atr: arrondi(atr) } : null,
    // Rappel explicite : ces consignes ne sont pas appliquées par ce module.
    applique: false
  };

  if (!recos.length) recos.push({ action: 'conserver', motif: `scénario intact (${rEnCours} R, stop à ${risqueRestantR} R)` });

  // Une même action peut être proposée par deux règles (sécuriser l'objectif ET
  // sécuriser le stop). À l'écran, une seule ligne par action : le motif le plus
  // précis est conservé, l'utilisateur n'a pas à lire deux fois « sécuriser ».
  const actionsVues = new Set();
  const recosUniques = [];
  for (const r of recos) {
    if (actionsVues.has(r.action)) continue;
    actionsVues.add(r.action);
    recosUniques.push(r);
  }

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
    plan,
    // Toujours vrai : ce module ne modifie jamais le stop d'une position.
    stopInchange: true,
    recommandations: recosUniques.slice(0, 3)
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
