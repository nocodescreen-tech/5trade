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
 * @param {object} [p.performances] statistiques réelles hors échantillon par stratégie (journal/stats)
 */
function selectionner({ candles, meta, strategies, regime = null, max = 3, performances = null } = {}) {
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

    if (profil.partiel || profil.reglesEcartees?.length || profil.filtresEcartes?.length || profil.timeframesRefusees?.length ||
        (doc.moteur && (!Array.isArray(doc.moteur.regles) || !doc.moteur.regles.length ||
          (doc.moteur.obligatoires || []).some(r => !profil.regles.includes(r))))) {
      return {...base,compatible:false,retenue:false,score:0,statut:'incomplet',motif:'contrat incomplet : conditions déclarées non exécutables'};
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
      verdict = Signals.detect(candles, meta || {}, { ...profil, profils: [profil], strict:true });
    } catch (e) {
      return { ...base, compatible: declare, retenue: false, score: 0,
        motif: `évaluation impossible : ${e.message}` };
    }

    const statut = (verdict && verdict.status) || 'inconnu';
    const force = Number.isFinite(verdict?.strength) ? Math.max(0,Math.min(1,verdict.strength)) : 0;
    const reglesActives = [...new Set((Array.isArray(verdict?.reglesPour) ? verdict.reglesPour : []).filter(r=>base.regles.includes(r)))];
    const preuves = Number.isInteger(verdict?.confirmations) && verdict.confirmations >= 0 ? Math.min(verdict.confirmations,reglesActives.length) : 0;
    const manquantes = Math.max(0, (profil.seuilRegles || 1) - preuves);

    // 5. Le setup est-il seulement présent ?
    let motif = null;
    if (statut === 'confirme') motif = 'setup confirmé sur ses propres règles';
    else if (statut === 'surveiller') {
      motif = manquantes
        ? `${preuves}/${profil.seuilRegles || 1} preuves distinctes réunies : configuration en observation`
        : 'configuration en observation (régime ou confirmation incomplète)';
    } else if (statut === 'rejete') {
      motif = `conditions non remplies : ${reglesActives.length} règle(s) sur ${profil.seuilRegles || 1} exigée(s)`;
    } else if (statut === 'neutre') {
      // « neutre » n'est pas « inconnu » : la stratégie a conclu qu'aucun biais
      // directionnel n'était établi sur ses règles.
      motif = 'aucun biais directionnel établi sur ses règles';
    } else motif = `état non exploitable (${statut})`;

    if (nonDeclare) motif += ' · marché non déclaré par la fiche';

    // Rôle réel du régime : si la stratégie déclare un ou plusieurs régimes et que
    // le marché a un régime détecté, un alignement donne un bonus (+25%).
    // Si la stratégie déclare des régimes et que le régime actuel est clairement discordant,
    // la stratégie est jugée incompatible avec le marché actuel et ne peut pas être retenue.
    let multiplicateurRegime = 1.0;
    let regimeIncompatible = false;
    if (profil && Array.isArray(profil.regimes) && profil.regimes.length) {
      const regimeNormalise = regime ? String(regime).toLowerCase() : null;
      const correspond = regimeNormalise
        && profil.regimes.some(r => String(r).toLowerCase() === regimeNormalise);
      if (!regimeNormalise || regimeNormalise === 'unknown') {
        multiplicateurRegime = 0.5;
        regimeIncompatible = true;
        motif += ' - regime non determine : setup limite a ' + profil.regimes.join(',');
      } else if (correspond) {
        multiplicateurRegime = 1.25;
        motif += ` · adapté au régime ${regime}`;
      } else {
        multiplicateurRegime = 0.5;
        regimeIncompatible = true;
        motif += ` · régime incompatible (${regime} vs ${profil.regimes.join(',')})`;
      }
    }

    // Apprentissage adaptatif basé sur les performances réelles hors échantillon (journal / stats).
    // Règle de prudence statistique : AUCUNE adaptation si le nombre de trades réels fermés
    // est inférieur à 15 (seuil de significativité minimale pour éviter le surapprentissage).
    let multiplicateurPerformance = 1.0;
    const statsStrat = performances && (performances[doc.id] || performances[doc.name] || performances[doc.title]);
    if (statsStrat && Number.isFinite(statsStrat.total)) {
      const SEUIL_MIN_TRADES = 15;
      if (statsStrat.total < SEUIL_MIN_TRADES) {
        motif += ` · données réelles insuffisantes pour adaptation (${statsStrat.total}/${SEUIL_MIN_TRADES} trades)`;
      } else {
        const esp = statsStrat.total > 0 ? ((Number(statsStrat.r) || 0) / statsStrat.total) : 0;
        if (esp >= 0.15) {
          multiplicateurPerformance = 1.20;
          motif += ` · performance historique observée (validation hors échantillon non établie) (+${esp.toFixed(2)} R/trade sur ${statsStrat.total} prises)`;
        } else if (esp < -0.10) {
          multiplicateurPerformance = 0.50;
          motif += ` · performance défavorable sur historique (${esp.toFixed(2)} R/trade sur ${statsStrat.total} prises)`;
        } else {
          motif += ` · performance neutre mesurée (${esp.toFixed(2)} R/trade)`;
        }
      }
    }

    const score = +(force * (POIDS[statut] !== undefined ? POIDS[statut] : 0) * multiplicateurRegime * multiplicateurPerformance).toFixed(3);
    return {
      ...base,
      compatible: declare && !regimeIncompatible,
      marcheNonDeclare: nonDeclare,
      regimeIncompatible,
      statut, direction: (verdict && verdict.direction) || null,
      force: +force.toFixed(3), score,
      reglesActives, preuvesDistinctes:preuves, seuilRegles: profil.seuilRegles || null,
      retenue: statut === 'confirme' && ['BUY','SELL'].includes(verdict?.direction) && manquantes === 0 && force >= (profil.seuilForce ?? 0) && (profil.obligatoires || []).every(r=>reglesActives.includes(r)) && declare && !regimeIncompatible,
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
  const retenues = [...parSignature.values()].slice(0, Math.max(0,Math.min(10,Number.isFinite(max)?Math.floor(max):3))).map(c => c.id);
  const idsRetenus = new Set(retenues);
  for (const c of tri) if (c.retenue && !idsRetenus.has(c.id)) { c.retenue=false; c.motif += ' · non retenue après classement/dédoublonnage'; }

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
