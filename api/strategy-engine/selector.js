/**
 * Sélecteur de stratégies.
 *
 * Constat : en mode automatique, `optionsAnalyse()` renvoyait `{ mode: 'auto' }`.
 * L'application analysait alors avec son moteur générique, sans jamais comparer
 * les fiches, sans dire lesquelles étaient compatibles, ni pourquoi les autres
 * étaient écartées.
 *
 * Ce module évalue CHAQUE fiche INDÉPENDAMMENT, avec ses propres règles, sa
 * compatibilité de marché et ses propres unités de temps. Il ne fusionne jamais
 * les règles de deux stratégies : additionner deux jeux de règles fabrique une
 * troisième stratégie que personne n'a écrite, et c'est exactement le faux
 * positif à interdire.
 *
 * Il ne prétend pas mesurer la rentabilité : il établit la COMPATIBILITÉ et
 * l'ÉTAT des conditions, et laisse les motifs d'exclusion visibles.
 */

const Signals = require('../engine/signals');
const { filtrerParClasse } = require('./strategy-contract');

/** Poids d'un état de stratégie dans le classement. */
const POIDS = { confirme: 1, surveiller: 0.5, rejete: 0, inconnu: 0 };

/**
 * @param {object} p
 * @param {Array} p.candles   bougies clôturées de l'unité de travail
 * @param {object} p.meta     { symbol, timeframe }
 * @param {Array} p.strategies fiches brutes (documents)
 * @param {string} [p.regime] régime de marché détecté, s'il est connu
 * @param {number} [p.max]    nombre de candidates retenues (défaut 3)
 */
function selectionner({ candles, meta, strategies, regime = null, max = 3 } = {}) {
  const fiches = Array.isArray(strategies) ? strategies : [];
  const symbole = (meta && meta.symbol) || null;
  if (!fiches.length) {
    return { candidates: [], retenues: [], motif: 'aucune fiche disponible', regime };
  }

  // Compatibilité de marché : le filtre existant, calculé UNE fois.
  const parClasse = filtrerParClasse(fiches, symbole);
  const compatibles = new Set((parClasse.compatibles || []).map(d => d.id));
  const nonDeclarees = new Set((parClasse.nonDeclarees || []).map(d => d.id));
  // `filtrerParClasse` renvoie `{ ...fiche, raison }` : l'identifiant est à la
  // racine, pas sous `.fiche`. La version précédente cherchait `r.fiche.id`,
  // donc la table des refus était vide et une fiche incompatible n'affichait
  // pas son motif.
  const refusees = new Map((parClasse.refusees || [])
    .map(r => [(r && (r.id || (r.fiche && r.fiche.id))) || null, r && r.raison])
    .filter(([id]) => id));

  const candidates = fiches.map(doc => {
    const profil = Signals.profilDepuisStrategie(doc);
    const base = {
      id: doc.id, titre: doc.title || doc.id,
      regles: profil.regles || [],
      timeframes: profil.timeframes || null,
      seuilRegles: profil.seuilRegles || null,
      partiel: !!profil.partiel,
      indicateurs: profil.indicateurs || []
    };

    // 0. Désactivée depuis le chat : plus candidate. Sans ce test, le drapeau
    //    `actif` serait décoratif et « désactive X » ne désactiverait rien.
    if (doc.actif === false) {
      return { ...base, compatible: false, retenue: false, score: 0,
        statut: 'inactive', motif: 'désactivée manuellement' };
    }

    // 1. Fiche sans règle exécutable : écartée, et on le dit.
    if (!profil.executable) {
      return { ...base, compatible: false, retenue: false, score: 0,
        motif: profil.motif || 'aucune règle exécutable' };
    }

    // 2. Marché incompatible : écartée avec la raison du contrat.
    if (refusees.has(doc.id)) {
      return { ...base, compatible: false, retenue: false, score: 0,
        motif: refusees.get(doc.id) || 'marché incompatible' };
    }
    // 3. Marché non déclaré : la fiche ne dit pas où elle s'applique.
    const declare = compatibles.has(doc.id);
    const nonDeclare = nonDeclarees.has(doc.id);

    // 4. Évaluation INDÉPENDANTE : cette fiche seule, ses règles seules.
    let verdict = null;
    try {
      verdict = Signals.detect(candles, meta || {}, { ...profil, profils: [profil] });
    } catch (e) {
      return { ...base, compatible: declare, retenue: false, score: 0,
        motif: `évaluation impossible : ${e.message}` };
    }

    const statut = (verdict && verdict.status) || 'inconnu';
    const force = Number.isFinite(verdict && verdict.force) ? verdict.force : 0;
    const reglesActives = (verdict && verdict.reglesActives) || [];
    const manquantes = Math.max(0, (profil.seuilRegles || 1) - reglesActives.length);

    // 5. Le setup est-il seulement présent ?
    let motif = null;
    if (statut === 'confirme') motif = 'setup confirmé sur ses propres règles';
    else if (statut === 'surveiller') {
      motif = manquantes
        ? `${reglesActives.length}/${profil.seuilRegles || 1} règles réunies : configuration en observation`
        : 'configuration en observation (régime ou confirmation incomplète)';
    } else if (statut === 'rejete') {
      motif = `conditions non remplies : ${reglesActives.length} règle(s) sur ${profil.seuilRegles || 1} exigée(s)`;
    } else if (statut === 'neutre') {
      // « neutre » n'est pas « inconnu » : la stratégie a conclu qu'aucun biais
      // directionnel n'était établi sur ses règles.
      motif = 'aucun biais directionnel établi sur ses règles';
    } else motif = `état non exploitable (${statut})`;

    if (nonDeclare) motif += ' · marché non déclaré par la fiche';

    const score = +(force * (POIDS[statut] !== undefined ? POIDS[statut] : 0)).toFixed(3);
    return {
      ...base,
      compatible: declare,
      marcheNonDeclare: nonDeclare,
      statut, direction: (verdict && verdict.direction) || null,
      force: +force.toFixed(3), score,
      reglesActives, seuilRegles: profil.seuilRegles || null,
      retenue: statut === 'confirme' && declare,
      motif
    };
  });

  // Classement : d'abord ce qui est retenu, puis par score décroissant. Une
  // fiche non déclarée n'est jamais retenue, même avec le meilleur score.
  const tri = [...candidates].sort((a, b) => (Number(b.retenue) - Number(a.retenue)) || (b.score - a.score));

  // DÉDOUBLONNAGE PAR JEU DE RÈGLES. Mesure : sur R_75, trois fiches étaient
  // « retenues » alors qu'elles appliquent la même règle R2 sur les mêmes
  // bougies. Les compter comme trois confirmations indépendantes gonfle
  // artificiellement la convergence. On garde la meilleure par jeu de règles et
  // on expose les doublons comme tels.
  const signature = c => (c.regles || []).slice().sort().join('+') || 'aucune';
  const parSignature = new Map();
  const doublons = [];
  for (const c of tri.filter(x => x.retenue)) {
    const sig = signature(c);
    if (!parSignature.has(sig)) parSignature.set(sig, c);
    else doublons.push({ id: c.id, memeReglesQue: parSignature.get(sig).id, regles: c.regles });
  }
  const retenues = [...parSignature.values()].slice(0, max).map(c => c.id);

  return {
    candidates: tri,
    retenues,
    // Fiches écartées du décompte parce qu'elles rejouent les mêmes règles.
    doublons,
    regime,
    motif: retenues.length
      ? `${retenues.length} stratégie(s) retenue(s) sur ${candidates.length} évaluée(s)`
        + (doublons.length ? ` · ${doublons.length} doublon(s) de règles écarté(s)` : '')
      : `aucune stratégie retenue : ${candidates.filter(c => c.compatible).length} compatible(s), `
        + `${candidates.filter(c => c.statut === 'surveiller').length} en observation`,
    compatibilite: { compatibles: compatibles.size, nonDeclarees: nonDeclarees.size, refusees: refusees.size }
  };
}

module.exports = { selectionner };
