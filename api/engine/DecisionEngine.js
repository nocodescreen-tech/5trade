/**
 * 5TRADE — DECISION ENGINE
 *
 * Arbitrage central : prend TOUS les signaux (stratégies + motifs + structure)
 * et produit UN verdict global cohérent avec traçabilité complète.
 *
 * 6 NIVEAUX SÉPARÉS (jamais mélangés) :
 *  1. DÉTECTION    — le moteur a trouvé une configuration (signaux bruts)
 *  2. VALIDATION   — conditions propres à la stratégie remplies (filtres, règles obligatoires)
 *  3. CONFIRMATION — confirmations obligatoires réunies (seuil règles, force, alignement MTF)
 *  4. EXÉCUTION    — setup réellement admissible (niveaux valides, RR, frais, modèle)
 *  5. ARBITRAGE    — décision finale : ACHAT / VENTE / ATTENTE / NO TRADE
 *  6. RISQUE       — les plafonds du compte autorisent-ils cette prise ?
 *
 * Chaque niveau expose : ok (bool), details[], raison si KO.
 * Le verdict final porte la traçabilité niveau par niveau.
 */

const Signals = require('./signals');
// SIGNAL NORMALIZER : la décision ne devine plus le dialecte qu'elle reçoit.
const Contrat = require('./contrat');
const Frais = require('../core/frais');
const Modele = require('./modele');

const r2 = x => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r3 = x => (Number.isFinite(x) ? +x.toFixed(3) : null);

/** Seuil par défaut pour considérer un signal comme "confirmé" au niveau stratégie. */
const SEUIL_FORCE_DEFAUT = 0.35;
const SEUIL_REGLES_DEFAUT = 2;

/**
 * NIVEAU 1 — DÉTECTION
 * Entrée : signaux bruts de detecterTout()
 * Sortie : signaux classés par source, avec leur statut moteur
 */
function niveauDetection(signaux) {
  const details = [];
  const parSource = { strategie: [], motif: [], structure: [] };

  for (const s of signaux) {
    const src = s.source || 'inconnu';
    if (!parSource[src]) parSource[src] = [];
    parSource[src].push({
      id: s.id,
      nom: s.nom,
      sens: s.sens,
      force: s.force,
      status: s.status,
      regles: s.regles || [],
      conditions: s.conditions || []
    });
    details.push({
      source: src,
      nom: s.nom,
      sens: s.sens,
      status: s.status,
      force: s.force
    });
  }

  const total = signaux.length;
  const confirmes = signaux.filter(s => s.status === 'confirme').length;
  const surveiller = signaux.filter(s => s.status === 'surveiller').length;

  return {
    ok: total > 0,
    details,
    resume: `${total} signal(s) détecté(s) — ${confirmes} confirmé(s), ${surveiller} à surveiller`,
    parSource,
    signauxBruts: signaux
  };
}

/**
 * NIVEAU 2 — VALIDATION
 * Vérifie : filtres exigés, règles obligatoires, conditions de la stratégie
 * Ne vote PAS sur la direction — dit seulement si la stratégie PEUT s'exprimer
 */
function niveauValidation(signaux, options = {}) {
  const details = [];
  let valides = 0;
  let bloques = 0;

  for (const s of signaux) {
    const nom = s.nom || s.id;
    const source = s.source || 'inconnu';
    const blocages = [];

    // Filtres exigés par la stratégie (ex: volatilité, session, structure)
    // Seulement pour les signaux de type 'strategie' qui ont ces champs
    if (source === 'strategie' && Array.isArray(s.filtresExiges) && s.filtresExiges.length) {
      const filtres = s.filtres || [];
      for (const cle of s.filtresExiges) {
        const f = filtres.find(x => x.cle === cle);
        if (f && !f.ok) {
          blocages.push(`filtre « ${f.label} » non rempli : ${f.detail}`);
        }
      }
    }

    // Règles obligatoires (ex: une stratégie qui exige R1 ET R2)
    if (source === 'strategie' && Array.isArray(s.obligatoires) && s.obligatoires.length) {
      for (const cle of s.obligatoires) {
        if (!s.reglesPour?.includes(cle) && !s.reglesConcordantes?.includes(cle)) {
          blocages.push(`règle obligatoire ${cle} absente`);
        }
      }
    }

    // Conditions du motif (pour les signaux de type 'motif')
    if (source === 'motif' && Array.isArray(s.conditions)) {
      const nonRemplies = s.conditions.filter(c => c.ok === false);
      if (nonRemplies.length) {
        blocages.push(`${nonRemplies.length} condition(s) du motif non remplie(s)`);
      }
    }

    // Structure : conditions de contexte (tendance, position dans le range)
    // NE PAS bloquer : structureContexte est informatif, pas un filtre exigé par la stratégie.
    // Les conditions de structure font partie du contexte de marché (comme le filtre 'structure' qui est optionnel).
    // Si la stratégie EXIGE le filtre 'structure', c'est géré plus haut via filtresExiges.
    // Ici on ne fait que remonter l'info, sans bloquer.
    if (source === 'structure' && s.structureContexte?.conditions) {
      // Ne rien faire : les conditions de structure sont du contexte, pas des filtres bloquants
      // const nonRemplies = s.structureContexte.conditions.filter(c => c.ok === false);
      // if (nonRemplies.length) {
      //   blocages.push(`${nonRemplies.length} condition(s) de structure non remplie(s)`);
      // }
    }

    if (blocages.length) {
      bloques++;
      details.push({ source, nom, ok: false, blocages, sens: s.sens, force: s.force });
    } else {
      valides++;
      details.push({ source, nom, ok: true, blocages: [], sens: s.sens, force: s.force });
    }
  }

  return {
    ok: valides > 0,
    details,
    resume: `${valides} signal(s) valide(s) sur ${signaux.length} — ${bloques} bloqué(s) par validation`,
    valides,
    bloques
  };
}

/**
 * NIVEAU 3 — CONFIRMATION
 * Vérifie : seuils de règles, force, alignement multi-timeframe, désaccord
 * C'est ici qu'on décide si un signal VALIDE devient CONFIRMÉ
 * Pour les signaux 'strategie' : seuils, force, confluence, contradiction
 * Pour les signaux 'structure'/'motif' : on garde leur status s'ils sont valides
 */
function niveauConfirmation(signaux, options = {}) {
  const details = [];
  let confirmes = 0;
  let surveiller = 0;
  let nonConfirmes = 0;

  const exigerAlignement = options.exigerAlignement !== false;
  const refuserDesaccord = options.refuserDesaccord !== false;
  const refuserContreTendance = options.refuserContreTendance !== false;
  const seuilAlignes = options.seuilAlignes || 2;

  for (const s of signaux) {
    const nom = s.nom || s.id;
    const source = s.source || 'inconnu';
    const blocages = [];
    let statusFinal = s.status;
    let alignementMTF = s.confluence ? (s.confluence.aligne ? 'aligné' : 'insuffisant') : null;

    if (source === 'strategie') {
      // Seulement les signaux de stratégie ont ces champs
      const confirmations = s.confirmations || 0;
      const seuilRegles = s.seuils?.regles || SEUIL_REGLES_DEFAUT;
      if (confirmations < seuilRegles) {
        blocages.push(`preuves distinctes ${confirmations}/${seuilRegles} < seuil`);
      }

      const force = Number(s.strength || s.force || 0);
      const seuilForce = s.seuils?.force || SEUIL_FORCE_DEFAUT;
      if (force < seuilForce) {
        blocages.push(`force ${force.toFixed(2)} < ${seuilForce.toFixed(2)}`);
      }

      if (refuserDesaccord && s.contradiction?.franche) {
        blocages.push(`désaccord franc entre règles (${s.contradiction.pour?.length || 0} pour / ${s.contradiction.contre?.length || 0} contre)`);
      }

      if (s.structureContexte?.ajustement <= -0.10 && s.status === 'confirme') {
        blocages.push(`structure défavorable (ajustement ${(s.structureContexte.ajustement || 0).toFixed(2)})`);
      }
    }
    // ── CONTEXTE DE MARCHÉ — commun à TOUTES les sources ──────────────────
    // Motifs et structures n'ont pas de seuils de fiche : on ne leur applique
    // donc pas ceux des stratégies. Mais ils vivent dans le MÊME marché.
    // Mesuré : un CHoCH et un Doji étaient confirmés et produisaient un ACHAT
    // alors que la trace notait « alignement 0/2 insuffisant ». Le contexte
    // n'est pas une propriété de la source, c'est une propriété du marché.
    if (exigerAlignement && s.confluence) {
      const conf = s.confluence;
      if (!conf.aligne) {
        blocages.push(`alignement MTF insuffisant : ${conf.nbAlignes}/${conf.detail?.length || 0} unités d'accord (seuil ${conf.seuilAlignes})`);
      }
      if (refuserContreTendance && conf.contreTendance) {
        blocages.push(`contre-tendance détectée : ${conf.motif}`);
      }
    }
    // Alignement exigé mais non fourni : on ne bloque pas (le moteur ne peut pas
    // inventer les autres unités), mais on l'ÉCRIT. Sans cette trace, le niveau
    // affichait « confirmé » alors que la vérification n'avait pas eu lieu.
    if (exigerAlignement && !s.confluence) {
      alignementMTF = 'non vérifié';
    }
    // Pour 'structure' et 'motif' : pas de seuils additionnels, leur status vient de leur propre logique

    if (blocages.length) {
      if (s.status === 'confirme') {
        statusFinal = 'surveiller';
        surveiller++;
      } else if (s.status === 'surveiller') {
        nonConfirmes++;
      } else {
        nonConfirmes++;
      }
    } else if (s.status === 'confirme') {
      confirmes++;
      statusFinal = 'confirme';
    } else if (s.status === 'surveiller') {
      surveiller++;
    } else {
      nonConfirmes++;
    }

    details.push({
      source,
      nom,
      statusInitial: s.status,
      statusFinal,
      ok: statusFinal === 'confirme',
      blocages,
      confirmations: s.confirmations || 0,
      force: Number(s.strength || s.force || 0),
      confluence: s.confluence ? { aligne: s.confluence.aligne, nbAlignes: s.confluence.nbAlignes } : null,
      // « non vérifié » = l'alignement était exigé mais aucune donnée multi-unités
      // n'a été fournie. L'écran doit pouvoir l'afficher au lieu de laisser croire
      // que le contrôle a eu lieu.
      alignementMTF: alignementMTF || 'non vérifié',
      contradiction: s.contradiction?.franche,
      ajustementStructure: s.structureContexte?.ajustement
    });
  }

  return {
    ok: confirmes > 0,
    details,
    resume: `${confirmes} confirmé(s), ${surveiller} à surveiller, ${nonConfirmes} non confirmé(s)`,
    confirmes,
    surveiller,
    nonConfirmes
  };
}

/**
 * NIVEAU 4 — EXÉCUTION
 * Vérifie : niveaux valides, RR minimum, frais, modèle (R attendu)
 * Un signal confirmé mais non exécutable = "à surveiller" (pas d'entrée publiée)
 */
function niveauExecution(signaux, meta, options = {}) {
  const details = [];
  let executables = 0;
  let nonExecutables = 0;

  const rrMin = options.rrMin || 0;
  const verifierFrais = options.verifierFrais !== false;
  const verifierModele = options.verifierModele !== false;

  for (const s of signaux) {
    const nom = s.nom || s.id;
    const source = s.source || 'inconnu';
    const blocages = [];
    let executable = false;

    // 0 bis. CHAÎNAGE DES NIVEAUX — l'exécution ne juge pas un signal que la
    //        confirmation a rejeté. Mesuré avant ce garde-fou : une décision
    //        « ACHAT » avec 0 confirmation et 1 exécutable, parce que les cinq
    //        niveaux étaient calculés EN PARALLÈLE et que l'arbitrage ne lisait
    //        que `executable`. Un niveau qui ne conditionne rien n'est pas un
    //        niveau, c'est une décoration.
    if (s.confirme === false) {
      blocages.push(`confirmation non acquise : un signal non confirmé n'est pas exécutable`);
      details.push({ source, nom, ok: false, blocages, sens: s.sens, confirme: false });
      nonExecutables++;
      continue;
    }

    // 0. Contrat de sortie : un signal qui ne respecte pas la forme commune
    //    (niveaux incohérents, statut inconnu, force hors bornes) n'est JAMAIS
    //    exécutable, quelle que soit la suite de l'analyse.
    if (s.contrat && s.contrat.ok === false) {
      blocages.push('hors contrat : '
        + [...(s.contrat.manquants || []), ...(s.contrat.invalides || [])].join(', '));
      details.push({ source, nom, ok: false, blocages, sens: s.sens });
      nonExecutables++;
      continue;
    }

    // Seuls les signaux "confirme" au niveau 3 peuvent être exécutables
    if (s.status !== 'confirme') {
      blocages.push(`statut ${s.status} : pas candidat à l'exécution`);
      details.push({ source, nom, ok: false, blocages, sens: s.sens });
      nonExecutables++;
      continue;
    }

    // Un seul vocabulaire : le SIGNAL NORMALIZER a déjà ramené les quatre
    // dialectes du dépôt (levels.entry, entree, symbole+target, cle+symbol) à la
    // forme du contrat. Ce bloc devinait auparavant lequel des deux il recevait.
    const c = Contrat.normaliser(s, { source: s.source });
    const entry = c.entree;
    const stop = c.stop;
    const target1 = c.objectifs[0];
    const target2 = c.objectifs[1];

    // 1. Niveaux valides (entrée, stop, objectifs du bon côté)
    if (!Number.isFinite(entry) || !Number.isFinite(stop)) {
      blocages.push('niveaux absents ou invalides');
    } else {
      const long = c.sens === 'long';
      if (long && stop >= entry) blocages.push('stop AU-DESSUS de l\'entrée (achat)');
      if (!long && stop <= entry) blocages.push('stop EN-DESSOUS de l\'entrée (vente)');
      if (target1 && long && target1 <= entry) blocages.push('objectif 1 du mauvais côté (achat)');
      if (target1 && !long && target1 >= entry) blocages.push('objectif 1 du mauvais côté (vente)');
    }

    // 2. RR minimum
    const rr = s.rr || (Number.isFinite(entry) && Number.isFinite(stop) && Number.isFinite(target1)
      ? Math.abs(target1 - entry) / Math.abs(entry - stop)
      : null);
    if (rrMin > 0 && rr !== null && Number.isFinite(rr)) {
      if (rr < rrMin) {
        blocages.push(`RR ${rr.toFixed(2)} < ${rrMin} minimum`);
      }
    }

    // 3. Frais de transaction (plafond de coût)
    if (verifierFrais && Number.isFinite(entry) && Number.isFinite(stop)) {
      const verdictFrais = Frais.plafondCout(entry, stop, meta.symbol);
      if (verdictFrais && !verdictFrais.ok) {
        blocages.push(`coût trop élevé : ${verdictFrais.raison} (part ${(verdictFrais.part * 100).toFixed(1)}% > ${(verdictFrais.partMax * 100).toFixed(1)}%)`);
        s.ecarteFrais = verdictFrais;
      }
    }

    // 4. Modèle (R attendu)
    if (verifierModele && s.modele && Number.isFinite(s.modele.rAttendu)) {
      const seuil = s.modele.seuil ?? 0;
      if (s.modele.rAttendu < seuil) {
        blocages.push(`R attendu ${s.modele.rAttendu} < seuil ${seuil} (modèle v${s.modele.version})`);
        s.ecarteModele = s.modele;
      }
    }

    if (blocages.length) {
      nonExecutables++;
      details.push({ source, nom, ok: false, blocages, sens: s.sens, force: s.force, rr });
    } else {
      executables++;
      executable = true;
      details.push({ source, nom, ok: true, blocages: [], sens: s.sens, force: s.force, rr, levels: { entry, stop, target1, target2 } });
    }
  }

  return {
    ok: executables > 0,
    details,
    resume: `${executables} exécutable(s), ${nonExecutables} non exécutable(s)`,
    executables,
    nonExecutables
  };
}

/**
 * NIVEAU 5 — ARBITRAGE (décision finale)
 * Prend les signaux EXÉCUTABLES et rend UN verdict global :
 *   ACHAT      — au moins un exécutable long, aucun short exécutable contradictoire
 *   VENTE      — au moins un exécutable short, aucun long exécutable contradictoire
 *   ATTENTE    — exécutables des deux côtés (conflit), ou un seul côté mais force faible
 *   NO_TRADE   — aucun exécutable, ou bloqué par garde-fous
 */
function niveauArbitrage(signaux, meta, options = {}) {
  const executables = signaux.filter(s => s.executable === true);
  const longs = executables.filter(s => s.sens === 'long' || s.direction === 'BUY');
  const shorts = executables.filter(s => s.sens === 'short' || s.direction === 'SELL');

  let decision = 'NO_TRADE';
  let raison = 'aucun signal exécutable';
  let signauxRetenus = [];
  let biais = 'neutre';

  if (longs.length > 0 && shorts.length === 0) {
    // Au moins un achat, aucune vente
    const meilleur = longs.sort((a, b) => (b.force || 0) - (a.force || 0))[0];
    decision = 'ACHAT';
    raison = `${longs.length} signal(s) d'achat exécutable(s), aucune vente — meilleur : ${meilleur.nom} (force ${(meilleur.force || 0).toFixed(2)})`;
    signauxRetenus = longs;
    biais = 'haussier';
  } else if (shorts.length > 0 && longs.length === 0) {
    // Au moins une vente, aucun achat
    const meilleur = shorts.sort((a, b) => (b.force || 0) - (a.force || 0))[0];
    decision = 'VENTE';
    raison = `${shorts.length} signal(s) de vente exécutable(s), aucun achat — meilleur : ${meilleur.nom} (force ${(meilleur.force || 0).toFixed(2)})`;
    signauxRetenus = shorts;
    biais = 'baissier';
  } else if (longs.length > 0 && shorts.length > 0) {
    // Conflit : les deux côtés ont des signaux exécutables
    const forceLongs = longs.reduce((a, b) => a + (b.force || 0), 0) / longs.length;
    const forceShorts = shorts.reduce((a, b) => a + (b.force || 0), 0) / shorts.length;
    const diff = Math.abs(forceLongs - forceShorts);

    if (diff < 0.15) {
      decision = 'ATTENTE';
      raison = `conflit : ${longs.length} achat(s) (force moy. ${forceLongs.toFixed(2)}) vs ${shorts.length} vente(s) (force moy. ${forceShorts.toFixed(2)}) — écart ${diff.toFixed(2)} < 0.15`;
      biais = 'partagé';
    } else if (forceLongs > forceShorts) {
      decision = 'ACHAT';
      const meilleur = longs.sort((a, b) => (b.force || 0) - (a.force || 0))[0];
      raison = `achat l'emporte (force moy. ${forceLongs.toFixed(2)} vs ${forceShorts.toFixed(2)}) — ${meilleur.nom}`;
      signauxRetenus = longs;
      biais = 'haussier';
    } else {
      decision = 'VENTE';
      const meilleur = shorts.sort((a, b) => (b.force || 0) - (a.force || 0))[0];
      raison = `vente l'emporte (force moy. ${forceShorts.toFixed(2)} vs ${forceLongs.toFixed(2)}) — ${meilleur.nom}`;
      signauxRetenus = shorts;
      biais = 'baissier';
    }
  } else {
    decision = 'NO_TRADE';
    raison = 'aucun signal exécutable après tous les filtres';
    biais = 'neutre';
  }

  // Meilleur signal retenu (pour l'affichage entrée/SL/TP)
  let meilleurSignal = null;
  if (signauxRetenus.length) {
    meilleurSignal = signauxRetenus.sort((a, b) => {
      // Priorité : R attendu du modèle > force > RR
      const rA = (a.modele && Number.isFinite(a.modele.rAttendu)) ? a.modele.rAttendu : -999;
      const rB = (b.modele && Number.isFinite(b.modele.rAttendu)) ? b.modele.rAttendu : -999;
      if (rA !== rB) return rB - rA;
      return (b.force || 0) - (a.force || 0);
    })[0];
  }

  return {
    decision,
    raison,
    biais,
    signauxRetenus: signauxRetenus.map(s => ({ id: s.id, nom: s.nom, source: s.source, sens: s.sens, force: s.force, rr: s.rr })),
    meilleurSignal: meilleurSignal ? {
      id: meilleurSignal.id,
      nom: meilleurSignal.nom,
      source: meilleurSignal.source,
      sens: meilleurSignal.sens,
      force: meilleurSignal.force,
      // Les niveaux existent sous DEUX formes dans le dépôt (levels.entry pour les
      // stratégies, entree/objectifs pour motifs et structure). On transporte les
      // deux : le garde-fou de risque et l'écran ne doivent pas dépendre du dialecte.
      levels: meilleurSignal.levels,
      entree: meilleurSignal.entree,
      stop: meilleurSignal.stop,
      objectifs: meilleurSignal.objectifs,
      rr: meilleurSignal.rr,
      modele: meilleurSignal.modele,
      structureContexte: meilleurSignal.structureContexte
    } : null,
    comptes: {
      total: signaux.length,
      detection: signaux.length,
      validation: signaux.filter(s => s.valide).length,
      confirmation: signaux.filter(s => s.confirme).length,
      execution: executables.length,
      arbitrage: signauxRetenus.length
    }
  };
}

/**
 * NIVEAU 6 — RISQUE (garde-fou de compte)
 *
 * Le moteur de risque (`risk/risque`, six plafonds) existait mais n'était appelé
 * qu'à l'INSCRIPTION au journal, donc APRÈS l'affichage. Mesuré : une décision
 * « VENTE, 1 exécutable » était publiée avec un compte en perte de 9 % pour un
 * plafond de 3 %.
 *
 * Fonction PURE : elle ne touche pas à l'arbitrage, elle rend ce qu'il faut
 * appliquer. `etat.consulte === false` signifie « aucun état de compte fourni »,
 * jamais « risque validé ».
 */
function niveauRisque(arbitrage, options = {}) {
  const etat = { consulte: false, ok: null, refus: [] };
  if (arbitrage.decision !== 'ACHAT' && arbitrage.decision !== 'VENTE') return { etat, decision: null };

  if (typeof options.verificateurRisque !== 'function') {
    return { etat: { ...etat, motif: 'aucun vérificateur de risque fourni' }, decision: null };
  }

  const c = arbitrage.meilleurSignal
    ? Contrat.normaliser(arbitrage.meilleurSignal, { source: 'verdict' }) : null;
  try {
    const v = options.verificateurRisque(c || {});
    if (v && v.ok === false) {
      const refus = v.refus || [v.raison].filter(Boolean);
      return {
        etat: { consulte: true, ok: false, refus },
        decision: 'ATTENTE',
        raison: 'Risque refusé : ' + (refus.join(' · ') || 'plafond atteint')
      };
    }
    return { etat: { consulte: true, ok: true, refus: [] }, decision: null };
  } catch (e) {
    // Un vérificateur en panne ne doit ni bloquer ni autoriser en silence.
    return { etat: { consulte: true, ok: null, refus: [], erreur: e.message }, decision: null };
  }
}

/**
 * PIPELINE COMPLET — point d'entrée unique
 * Prend la sortie de detecterTout() et renvoie le verdict global + traçabilité
 */
function decider(candles, meta, options = {}) {
  // 0. On récupère TOUS les signaux (stratégies + motifs + structure)
  const multi = require('./signaux').detecterTout(candles, meta, options);
  const signaux = multi.signaux || [];

  // Enrichir chaque signal avec les infos nécessaires aux niveaux suivants
  const signauxEnrichis = signaux.map(s => ({
    ...s,
    // Pour niveauValidation
    filtres: s.filtres || [],
    filtresExiges: s.filtresExiges || [],
    obligatoires: s.obligatoires || [],
    reglesPour: s.reglesPour || [],
    reglesConcordantes: s.reglesConcordantes || [],
    // Pour niveauConfirmation
    confirmations: s.confirmations || 0,
    seuils: s.seuils || {},
    confluence: s.confluence || null,
    contradiction: s.contradiction || null,
    structureContexte: s.structureContexte || null,
    // Pour niveauExecution
    levels: s.levels || null,
    rr: s.rr || null,
    ecartesFrais: s.ecarteFrais || null,
    modele: s.modele || null
  }));

  // Pipeline des 5 niveaux
  const detection = niveauDetection(signauxEnrichis);
  const validation = niveauValidation(signauxEnrichis, options);
  const confirmation = niveauConfirmation(signauxEnrichis, options);
  // Le niveau 4 reçoit le verdict du niveau 3 : sans cette transmission, il
  // jugeait des signaux que la confirmation venait de rejeter.
  const execution = niveauExecution(
    signauxEnrichis.map((s, i) => ({ ...s, confirme: confirmation.details[i]?.ok })),
    meta, options
  );
  const arbitrage = niveauArbitrage(
    signauxEnrichis.map((s, i) => ({ ...s, valide: validation.details[i]?.ok, confirme: confirmation.details[i]?.ok, executable: execution.details[i]?.ok })),
    meta,
    options
  );

  // 6. RISQUE — garde-fou de COMPTE (niveau pur, appliqué ici)
  const garde = niveauRisque(arbitrage, options);
  if (garde.decision) {
    arbitrage.decision = garde.decision;
    arbitrage.raison = garde.raison;
  }
  const risque = garde.etat;

  // Verdict final unifié
  const verdict = {
    // Décision finale
    decision: arbitrage.decision,           // ACHAT | VENTE | ATTENTE | NO_TRADE
    raison: arbitrage.raison,
    // Garde-fou de compte : consulte=false signifie « aucun état de compte fourni »,
    // jamais « risque validé ». L'écran doit pouvoir le dire.
    risque,
    biais: arbitrage.biais,

    // Meilleur signal pour exécution
    signal: arbitrage.meilleurSignal,

    // Tous les signaux classés (pour l'affichage liste)
    signaux: multi.signaux,
    synthese: multi.synthese,

    // Contexte de marché (carte)
    carte: multi.carte,

    // Traçabilité complète niveau par niveau
    trace: {
      // Les COMPTEURS voyagent avec la trace : sans eux, un consommateur qui
      // veut « 3 / 17 » doit recompter `details`, et finit par afficher
      // « undefined / 17 » quand il cherche un champ qui n'existe pas.
      detection: {
        ok: detection.ok, resume: detection.resume, details: detection.details,
        total: (detection.details || []).length
      },
      validation: {
        ok: validation.ok, resume: validation.resume, details: validation.details,
        valides: validation.valides, bloques: validation.bloques,
        total: (validation.details || []).length
      },
      confirmation: {
        ok: confirmation.ok, resume: confirmation.resume, details: confirmation.details,
        confirmes: confirmation.confirmes, surveiller: confirmation.surveiller,
        nonConfirmes: confirmation.nonConfirmes,
        total: (confirmation.details || []).length
      },
      execution: {
        ok: execution.ok, resume: execution.resume, details: execution.details,
        executables: execution.executables, nonExecutables: execution.nonExecutables,
        total: (execution.details || []).length
      },
      arbitrage: { decision: arbitrage.decision, raison: arbitrage.raison, biais: arbitrage.biais, comptes: arbitrage.comptes },
      risque: { consulte: risque.consulte, ok: risque.ok, refus: risque.refus, motif: risque.motif || null }
    },

    // Métadonnées
    at: multi.at,
    symbol: multi.symbol,
    timeframe: multi.timeframe,
    price: multi.price,
    atr: multi.atr,
    options: {
      exigerAlignement: options.exigerAlignement !== false,
      refuserDesaccord: options.refuserDesaccord !== false,
      refuserContreTendance: options.refuserContreTendance !== false,
      rrMin: options.rrMin || 0,
      seuilAlignes: options.seuilAlignes || 2
    }
  };

  return verdict;
}

/**
 * Version simplifiée pour le flux SSE — réutilise decider() mais format allégé
 */
function deciderStream(verdict) {
  if (!verdict) return { status: 'indisponible', direction: 'NEUTRE' };

  const s = verdict.signal;
  if (!s) {
    return {
      status: verdict.decision === 'ATTENTE' ? 'surveiller' : 'neutre',
      direction: verdict.biais === 'haussier' ? 'BUY' : verdict.biais === 'baissier' ? 'SELL' : 'NEUTRE',
      decision: verdict.decision,
      raison: verdict.raison,
      force: 0,
      trace: verdict.trace
    };
  }

  return {
    status: verdict.decision === 'ACHAT' || verdict.decision === 'VENTE' ? 'confirme' : 'surveiller',
    direction: s.sens === 'long' ? 'BUY' : 'SELL',
    decision: verdict.decision,
    raison: verdict.raison,
    force: s.force,
    levels: s.levels,
    rr: s.rr,
    modele: s.modele,
    structureContexte: s.structureContexte,
    trace: verdict.trace
  };
}

module.exports = {
  decider,
  deciderStream,
  niveauDetection,
  niveauValidation,
  niveauConfirmation,
  niveauExecution,
  niveauArbitrage
};