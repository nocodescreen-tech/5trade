/**
 * 5trade — MOTEUR MULTI-SIGNAUX.
 *
 * Le problème résolu : `Signals.detect()` rend UN verdict. Sélectionner cinq
 * stratégies ne produisait donc pas cinq signaux — les règles étaient UNIES
 * (`server.js`, `optionsAnalyse`) et le trader lisait un seul résultat qui ne
 * correspondait à aucune de ses stratégies en particulier.
 *
 * Ici, chaque stratégie sélectionnée est évaluée SÉPARÉMENT, et chaque motif de
 * bougie/graphique détecté devient son propre signal. L'écran reçoit une LISTE :
 *
 *   • un signal par stratégie choisie (avec son nom, ses règles, son seuil)
 *   • un signal par motif rempli (marteau, double bottom, trendline cassée…)
 *   • un signal de structure (les 4 règles SMC) en lecture de contexte
 *
 * Doctrine reprise du reste du moteur : **une condition non remplie n'est pas
 * une erreur, c'est une information**. Chaque signal porte donc `conditions[]`
 * avec la valeur mesurée ET le seuil, que la condition soit remplie ou non. Un
 * concept qui ne se déclenche pas doit rester VISIBLE avec sa raison.
 */

const Signals = require('./signals');
// Le moteur de structure (BOS/CHoCH, order blocks, FVG, sweeps, premium/discount,
// liquidité, PDH/PDL, ATR) existait déjà mais n'était PAS branché sur les signaux :
// un marteau était signalé sans savoir s'il se formait contre la tendance, en
// premium, loin de toute zone. Un signal sans son contexte de marché n'est pas un
// signal : c'est une figure géométrique.
const Structure = require('./structure');
const Plans = require('./plans');
const Patterns = require('./patterns');
// Frais de transaction : le plafond de coût (étape 5 de detecterTout) a besoin
// de la configuration réelle. Sans ce require, `Frais is not defined` ne casse
// pas la syntaxe — le canonique meurt seulement à l exécution.
const Frais = require('../core/frais');
// Modèle exporté (R attendu) : pondère les signaux sans remplacer les règles.
const Modele = require('./modele');
// Garde-fou des niveaux : implémentation UNIQUE, partagée avec le verdict du
// direct (`signals.js`). Deux copies d'une même règle finissent par diverger.
const { assainirNiveaux, arrondiPrix } = require('./niveaux');
// Contrat de sortie commun aux deux moteurs (forme + validation).
const Contrat = require('./contrat');
// Étage Market Intelligence : le régime de marché conditionne ce qui peut être
// confirmé. Il était écrit, testé, et appelé par personne.
const Regime = require('../market-intelligence/regime-detector');

const r2 = x => (Number.isFinite(x) ? +x.toFixed(2) : null);
// `arrondiPrix` vit désormais dans `engine/niveaux.js` (partagé avec le direct).

/** BUY/SELL (vocabulaire du moteur) → long/short (vocabulaire du trader). */
const sensDe = dir => (dir === 'BUY' ? 'long' : dir === 'SELL' ? 'short' : 'neutre');

/** Statut du moteur → statut de signal. */
function statutDe(status) {
  if (status === 'confirme') return 'confirme';
  if (status === 'surveiller') return 'surveiller';
  return 'rejete';
}

// ─────────────────────────────────────────────────────────────
// NIVEAUX : entrée, invalidation, objectifs — par type de motif
// ─────────────────────────────────────────────────────────────
/**
 * Un motif sans niveaux n'est pas exploitable : le trader lit « marteau » mais ne
 * sait pas où il se trompe. Chaque famille a sa logique d'invalidation propre :
 *   • motif de bougie  → l'extrême de la bougie invalide le motif ;
 *   • double top/bottom → le col (et les deux extrêmes) ;
 *   • trendline        → la marge de cassure ;
 *   • support/résistance → le niveau lui-même ;
 *   • compression/doji/inside → aucune direction : pas de niveaux, et on le dit.
 */
function niveauxMotif(motif, candles, atr) {
  const brut = niveauxMotifBrut(motif, candles, atr);
  return assainirNiveaux(brut, motif.sens, atr);
}

function niveauxMotifBrut(motif, candles, atr) {
  const dernier = candles[candles.length - 1];
  if (!dernier || !atr) return null;
  const close = dernier.c;
  const c = motif.chiffres || {};

  // Motifs sans direction : on n'invente pas un sens.
  if (!motif.ok || motif.sens === 'neutre') return null;

  const long = motif.sens === 'long';
  const sens = long ? 1 : -1;

  switch (motif.id) {
    case 'double-bottom': {
      const creux = Math.min(Number(c.creux1), Number(c.creux2));
      const col = Number(c.col);
      const hauteur = col - creux;
      if (!Number.isFinite(creux) || !Number.isFinite(col) || hauteur <= 0) return null;
      return {
        entree: arrondiPrix(close), stop: arrondiPrix(creux - 0.2 * atr),
        objectifs: [arrondiPrix(col + hauteur), arrondiPrix(col + 2 * hauteur)],
        base: `creux ${arrondiPrix(creux)} · col ${arrondiPrix(col)} · hauteur ${arrondiPrix(hauteur)}`
      };
    }
    case 'double-top': {
      const sommet = Math.max(Number(c.sommet1), Number(c.sommet2));
      const col = Number(c.col);
      const hauteur = sommet - col;
      if (!Number.isFinite(sommet) || !Number.isFinite(col) || hauteur <= 0) return null;
      return {
        entree: arrondiPrix(close), stop: arrondiPrix(sommet + 0.2 * atr),
        objectifs: [arrondiPrix(col - hauteur), arrondiPrix(col - 2 * hauteur)],
        base: `sommets ${arrondiPrix(sommet)} · col ${arrondiPrix(col)} · hauteur ${arrondiPrix(hauteur)}`
      };
    }
    case 'marteau':
    case 'pin-bar':
    case 'avalement':
    case 'harami': {
      // L'invalidation est l'extrême bas (achat) ou haut (vente) de la bougie.
      const stop = long ? dernier.l - 0.2 * atr : dernier.h + 0.2 * atr;
      return {
        entree: arrondiPrix(close), stop: arrondiPrix(stop),
        objectifs: [arrondiPrix(close + sens * atr), arrondiPrix(close + sens * 2 * atr)],
        base: `extrême de la bougie ${long ? arrondiPrix(dernier.l) : arrondiPrix(dernier.h)} ± 0,2× ATR`
      };
    }
    case 'etoile-filante':
    case 'avalement-baissier': {
      const stop = dernier.h + 0.2 * atr;
      return {
        entree: arrondiPrix(close), stop: arrondiPrix(stop),
        objectifs: [arrondiPrix(close - atr), arrondiPrix(close - 2 * atr)],
        base: `extrême haut ${arrondiPrix(dernier.h)} ± 0,2× ATR`
      };
    }
    case 'marubozu': {
      const stop = long ? dernier.l - 0.2 * atr : dernier.h + 0.2 * atr;
      return {
        entree: arrondiPrix(close), stop: arrondiPrix(stop),
        objectifs: [arrondiPrix(close + sens * atr), arrondiPrix(close + sens * 2 * atr)],
        base: `momentum : corps ${c.corpsRatio} du range`
      };
    }
    case 'trendline': {
      const depasse = Number(c.depassement);
      return {
        entree: arrondiPrix(close), stop: arrondiPrix(close - sens * Math.max(atr * 0.5, depasse * 0.5)),
        objectifs: [arrondiPrix(close + sens * atr), arrondiPrix(close + sens * 2 * atr)],
        base: `dépassement mesuré ${arrondiPrix(depasse)}`
      };
    }
    case 'support-resistance': {
      const niveau = Number(c.niveau);
      if (!Number.isFinite(niveau)) return null;
      // Un « rebond » n'existe que si le prix est du BON côté du niveau. Un
      // achat SOUS le support n'est pas un rebond, c'est une cassure : mesuré
      // sur le journal (Support 4118.44, prix 4116.54), ces signaux étaient
      // faux dès l'émission et se faisaient invalider en une bougie.
      if (long && close <= niveau) return null;
      if (!long && close >= niveau) return null;
      // Stop sous le niveau ET à au moins 0,5 ATR de l'entrée : on prend le plus
      // ÉLOIGNÉ des deux. Avant, le stop venait du niveau seul, donc un prix
      // collé au niveau donnait un risque de 0,09 ATR.
      const stop = long
        ? Math.min(niveau - 0.25 * atr, close - 0.5 * atr)
        : Math.max(niveau + 0.25 * atr, close + 0.5 * atr);
      return {
        entree: arrondiPrix(close), stop: arrondiPrix(stop),
        objectifs: [arrondiPrix(close + sens * atr), arrondiPrix(close + sens * 2 * atr)],
        base: `niveau ${arrondiPrix(niveau)} touché ${c.touches} fois`
      };
    }
    default:
      return null;
  }
}

/** Ratio gain/risque du premier objectif. */
function rrDe(niv) {
  if (!niv || !Number.isFinite(niv.entree) || !Number.isFinite(niv.stop)) return null;
  const risque = Math.abs(niv.entree - niv.stop);
  const gain = Math.abs((niv.objectifs[0] ?? niv.entree) - niv.entree);
  if (risque <= 0) return null;
  return +((gain / risque)).toFixed(2);
}

// ─────────────────────────────────────────────────────────────
// CONDITIONS : ce qui est rempli, ce qui ne l'est pas — avec les chiffres
// ─────────────────────────────────────────────────────────────
/** Seuils lisibles par motif, pour transformer `chiffres` en conditions. */
function conditionsMotif(motif) {
  const c = motif.chiffres || {};
  const C = (nom, valeur, seuil, ok) => ({ nom, valeur, seuil, ok });

  switch (motif.id) {
    case 'doji':
      return [C('corps / range (%)', c.corpsRatio != null ? +(c.corpsRatio * 100).toFixed(1) : null, '≤ 10', (c.corpsRatio ?? 1) <= 0.10),
              C('range / ATR', c.rangeAtr, '≥ 0,3', (c.rangeAtr ?? 0) >= 0.3)];
    case 'marteau':
      return [C('mèche basse / corps', c.ratioMeche, '≥ 2', (c.ratioMeche ?? 0) >= 2),
              C('close dans le range (%)', c.closePctRange, '≥ 60', (c.closePctRange ?? 0) >= 60),
              C('mèche haute / range (%)', c.mecheHautePctRange, '≤ 15', (c.mecheHautePctRange ?? 100) <= 15),
              C('range / ATR', c.rangeAtr, '≥ 0,5', (c.rangeAtr ?? 0) >= 0.5),
              C('bougies baissières avant', c.baisseAvant, '≥ 0,5', (c.baisseAvant ?? 0) >= 0.5)];
    case 'etoile-filante':
      return [C('mèche haute / corps', c.ratioMeche, '≥ 2', (c.ratioMeche ?? 0) >= 2),
              C('close dans le range (%)', c.closePctRange, '≤ 40', (c.closePctRange ?? 100) <= 40),
              C('mèche basse / range (%)', c.mecheBassePctRange, '≤ 15', (c.mecheBassePctRange ?? 100) <= 15),
              C('range / ATR', c.rangeAtr, '≥ 0,5', (c.rangeAtr ?? 0) >= 0.5),
              C('bougies haussières avant', c.hausseAvant, '≥ 0,5', (c.hausseAvant ?? 0) >= 0.5)];
    case 'marubozu':
      return [C('corps / range (%)', c.corpsRatio != null ? +(c.corpsRatio * 100).toFixed(1) : null, '≥ 90', (c.corpsRatio ?? 0) >= 0.9),
              C('range / ATR', c.rangeAtr, '≥ 0,6', (c.rangeAtr ?? 0) >= 0.6)];
    case 'pin-bar':
      return [C('mèche dominante / range (%)', Math.max((c.mecheBasseRatio ?? 0), (c.mecheHauteRatio ?? 0)) * 100, '≥ 66', Math.max((c.mecheBasseRatio ?? 0), (c.mecheHauteRatio ?? 0)) >= 0.66),
              C('corps / range (%)', (c.corpsRatio ?? 1) * 100, '≤ 33', (c.corpsRatio ?? 1) <= 0.33),
              C('range / ATR', c.rangeAtr, '≥ 0,5', (c.rangeAtr ?? 0) >= 0.5)];
    case 'avalement':
    case 'avalement-baissier':
      return [C('corps courant (englobe)', c.corpsActuel, `> ${r2(c.corpsPrecedent)}`, (c.corpsActuel ?? 0) > (c.corpsPrecedent ?? 0)),
              C('range / ATR', c.rangeAtr, '≥ 0,5', (c.rangeAtr ?? 0) >= 0.5)];
    case 'harami':
      return [C('corps courant (contenu)', c.corpsCourant, `≤ ${r2((c.corpsPrecedent ?? 0) / 2)}`, (c.corpsCourant ?? 1) <= (c.corpsPrecedent ?? 0) / 2)];
    case 'inside-bar':
      return [C('range courant', r2(c.hautCourant - c.basCourant), `⊂ ${r2(c.hautPrecedent - c.basPrecedent)}`, motif.ok)];
    case 'double-top':
    case 'double-bottom': {
      const e1 = motif.id === 'double-top' ? c.sommet1 : c.creux1;
      const e2 = motif.id === 'double-top' ? c.sommet2 : c.creux2;
      // Pas de paire trouvée : `chiffres` ne porte alors ni `ecart` ni `cassure`.
      // On affiche ce qui a été COMPTÉ, jamais un `undefined` à l'écran.
      if (e1 == null && e2 == null) {
        return [C('extrêmes trouvés', `${c.extremes ?? 0}`, '≥ 2', (c.extremes ?? 0) >= 2),
                C('tolérance d\'écart', c.tolerance, 'écart max autorisé', false)];
      }
      return [C('écart entre extrêmes', c.ecart, `≤ ${r2(c.tolerance)}`, (c.ecart ?? 999) <= (c.tolerance ?? 0)),
              C('col cassé', c.cassure ? 'oui' : 'non', 'oui', !!c.cassure)];
    }
    case 'trendline':
      // Quand aucune trendline n'est cassée, `chiffres` ne porte pas de
      // `depassement` : on affiche alors ce qui a été MESURÉ (nombre d'extrêmes,
      // pentes, marge exigée) au lieu d'un « undefined » qui ne veut rien dire.
      return c.depassement != null
        ? [C('dépassement', c.depassement, `> ${r2(c.marge)}`, c.depassement > c.marge)]
        : [C('extrêmes trouvés', `${c.hauts ?? 0} sommet(s) / ${c.bas ?? 0} creux`, '≥ 2 par droite', false),
           C('marge exigée', c.marge, 'dépassement', false)];
    case 'compression':
      return [C('ATR court / ATR long (%)', c.ratio != null ? +(c.ratio * 100).toFixed(0) : null, '≤ 60', (c.ratio ?? 1) <= 0.6)];
    case 'support-resistance':
      return [C('touches du niveau', c.touches, '≥ 2', (c.touches ?? 0) >= 2),
              C('distance au niveau', c.distance, `≤ ${r2((c.tolerance ?? 0) * 2)}`, (c.distance ?? 999) <= (c.tolerance ?? 0) * 2)];
    default:
      return [];
  }
}

// ─────────────────────────────────────────────────────────────
// SIGNAUX D'UNE STRATÉGIE
// ─────────────────────────────────────────────────────────────
/**
 * Évalue UNE stratégie, avec SON jeu de règles et SES seuils — sans les unir aux
 * autres. C'est le correctif central : cinq stratégies = cinq évaluations.
 */
function signalStrategie(candles, meta, profil) {
  const opts = {
    regles: profil.regles,
    seuilForce: profil.seuilForce,
    seuilRegles: profil.seuilRegles,
    filtres: profil.filtres,
    parametres: profil.parametres,
    // Les conditions OBLIGATOIRES doivent traverser : sans elles, le moteur
    // interne ne peut jamais rendre 'refuse' et seul le calcul local (plus bas)
    // protège. Une règle écrite deux fois finit toujours par diverger.
    obligatoires: profil.obligatoires || [],
    strategie: { id: profil.id, titre: profil.titre }
  };

  let v;
  try {
    v = Signals.detect(candles, meta, opts);
  } catch (e) {
    return {
      id: `strat:${profil.id || profil.titre}`,
      source: 'strategie',
      nom: profil.titre || profil.id || 'Stratégie',
      strategie: profil.titre || null,
      concept: null,
      tf: meta.timeframe || null,
      sens: 'neutre',
      status: 'erreur',
      force: 0,
      conditions: [],
      preuves: [],
      entree: null, stop: null, objectifs: [], rr: null,
      raison: e.message,
      timeframesStrategie: profil.timeframes || null,
      regles: profil.regles || []
    };
  }

  // Conditions = les règles demandées par LA stratégie, avec leur verdict réel.
  // ATTENTION à la forme : `reglesPour` / `reglesContre` / `reglesMuettes` sont des
  // tableaux d'IDENTIFIANTS (« R3 »), pas des objets `{rule}`. Les traiter comme
  // des objets rendait chaque condition « non évaluée » alors que la règle avait
  // bien voté — une stratégie confirmée affichait 0/4 conditions.
  const pour = new Set(v.reglesPour || []);
  const contre = new Set(v.reglesContre || []);
  const muettes = new Set(v.reglesMuettes || []);
  const conditions = (profil.regles || []).map(id => ({
    nom: `Règle ${id}`,
    valeur: pour.has(id) ? 'pour' : contre.has(id) ? 'contre' : muettes.has(id) ? 'sans avis' : 'non évaluée',
    seuil: 'pour',
    ok: pour.has(id)
  }));

  // Les seuils de la stratégie sont aussi des conditions : ils sont chiffrés.
  conditions.push({
    nom: 'Preuves distinctes',
    valeur: v.confirmations,
    seuil: `≥ ${profil.seuilRegles}`,
    ok: (v.confirmations || 0) >= (profil.seuilRegles || 1)
  });
  conditions.push({
    nom: 'Force',
    valeur: r2(v.strength),
    seuil: `≥ ${profil.seuilForce}`,
    ok: (v.strength || 0) >= (profil.seuilForce || 0)
  });

  // ── Conditions OBLIGATOIRES de la stratégie ──
  // Ce moteur (utilisé par le BACKTEST et par la liste multi-signaux) ne les
  // appliquait pas : une stratégie pouvait donc être « confirmée » au backtest
  // alors que le direct refuse le signal. Deux moteurs, deux vérités — le défaut
  // le plus grave possible pour une mesure.
  const obligatoires = Array.isArray(profil.obligatoires) ? profil.obligatoires.filter(Boolean) : [];
  const bloquees = obligatoires.filter(id => !pour.has(id));
  if (obligatoires.length) {
    conditions.push({
      nom: 'Conditions obligatoires',
      valeur: `${obligatoires.length - bloquees.length}/${obligatoires.length}`,
      seuil: 'toutes',
      ok: bloquees.length === 0
    });
  }

  // Les filtres exigés bloquent la confirmation : ils doivent apparaître.
  for (const f of (v.filtres || [])) {
    if (!v.filtresExiges || !v.filtresExiges.includes(f.cle)) continue;
    conditions.push({ nom: `Filtre ${f.cle}`, valeur: f.ok ? 'ok' : (f.detail || 'non'), seuil: 'ok', ok: !!f.ok });
  }

  // Les niveaux d'une STRATÉGIE viennent de `Signals.levelsFor` et n'avaient pas
  // passé la garde `assainirNiveaux` : mesuré, 61 trades sur 62 d'EUR/USD
  // sortaient avec une entrée ÉGALE au stop (arrondi à 2 décimales sur un prix
  // de 1,12). Un trade sans risque n'est pas un trade — on assainit ici aussi,
  // avec le même plancher que les motifs et la structure.
  const sensSignal = sensDe(v.direction);
  const atrNiveaux = Number.isFinite(v.atr) ? v.atr
    : (() => { try { return Structure.atr(candles, 14); } catch { return null; } })();
  // Plan de trade : celui du moteur s'il en produit un, sinon celui de la FAMILLE
  // de setup déclarée par la stratégie (`profil.plan`). Sans ce second chemin,
  // toutes les stratégies étaient limitées aux rares cas où la structure fournit
  // un plan complet — c'est ce qui plafonnait le nombre de trades mesurables.
  let brut = v.levels ? {
    entree: arrondiPrix(v.levels.entry),
    stop: arrondiPrix(v.levels.stop),
    objectifs: [arrondiPrix(v.levels.target1), arrondiPrix(v.levels.target2)].filter(Number.isFinite)
  } : null;
  if (!brut && profil.plan) {
    const construit = Plans.construire(candles, sensSignal, profil.plan, options.planOptions || {});
    if (construit) {
      brut = {
        entree: construit.entree,
        stop: construit.stop,
        objectifs: construit.objectifs
      };
    }
  }
  const niveaux = assainirNiveaux(brut, sensSignal, atrNiveaux);

  return {
    id: `strat:${profil.id || profil.titre}`,
    source: 'strategie',
    nom: profil.titre || profil.id || 'Stratégie',
    strategie: profil.titre || null,
    concept: null,
    tf: meta.timeframe || null,
    sens: sensSignal,
    // Une condition obligatoire manquante interdit la confirmation, quel que soit
    // le score : c'est la même règle que le direct.
    // 'refuse' et non 'surveiller' : le backtest accepte les deux premiers, un
    // signal qui viole une condition obligatoire ne doit pas être compté du tout.
    status: bloquees.length ? 'refuse' : statutDe(v.status),
    bloquees: bloquees.length ? bloquees : undefined,
    force: r2(v.strength) || 0,
    conditions,
    preuves: v.preuves || [],
    entree: niveaux ? niveaux.entree : null,
    stop: niveaux ? niveaux.stop : null,
    objectifs: niveaux ? niveaux.objectifs : [],
    // `rr` doit être CALCULÉ, pas nul. Codé en dur à null, il faisait échouer
    // tous les signaux de stratégie au filtre de rapport risque/rendement, qui
    // leur retirait leurs niveaux : aucune stratégie ne produisait de trade.
    // Mesuré : 0 trade `strategie` sur 957 en backtest, avant ce correctif.
    rr: rrDe(niveaux),
    raison: v.summary || null,
    // Ce que la stratégie DEMANDAIT sans l'obtenir (R5 jetée, filtre inconnu) :
    // un filtrage silencieux est un bug, on le remonte.
    ecartes: { regles: profil.reglesEcartees || [], filtres: profil.filtresEcartes || [] },
    timeframesStrategie: profil.timeframes || null,
    regles: profil.regles || [],
    // Détail du moteur, conservé pour l'écran qui affiche déjà un verdict.
    verdict: v
  };
}

// ─────────────────────────────────────────────────────────────
// SIGNAUX DES MOTIFS
// ─────────────────────────────────────────────────────────────
function signauxMotifs(candles, meta, analyseMotifs) {
  const atr = analyseMotifs.atr;
  return analyseMotifs.motifs.map(m => {
    const niv = niveauxMotif(m, candles, atr);
    return {
      id: `motif:${m.id}`,
      source: 'motif',
      nom: m.nom,
      strategie: null,
      concept: m.famille,
      tf: meta.timeframe || null,
      sens: m.sens,
      // Un motif « rempli » n'est pas un signal confirmé : il décrit une figure.
      // Le seuil de fiabilité est explicite (0,6) et affiché.
      status: m.ok ? (m.force >= 0.6 ? 'confirme' : 'surveiller') : 'rejete',
      force: m.force,
      conditions: conditionsMotif(m),
      preuves: m.preuves || [],
      entree: niv ? niv.entree : null,
      stop: niv ? niv.stop : null,
      objectifs: niv ? niv.objectifs : [],
      rr: niv ? rrDe(niv) : null,
      base: niv ? niv.base : null,
      raison: m.raison || null,
      // Exposé pour que l'écran montre le détail chiffré brut.
      chiffres: m.chiffres
    };
  });
}

// ─────────────────────────────────────────────────────────────
// COUCHE MARCHÉ RÉEL — structure, zones, liquidité
// ─────────────────────────────────────────────────────────────
/**
 * Carte de marché : la lecture structurelle d'un graphique, calculée une seule
 * fois et réutilisée pour TOUS les signaux.
 *
 * Sans elle, chaque signal vivait isolé : un « marteau » haussier était annoncé
 * même s'il se formait en premium, contre une tendance baissière, à trois ATR de
 * toute zone. Le trader lisait alors une figure juste… dans un marché qui disait
 * l'inverse. Ici la structure devient le cadre de lecture du signal.
 */
function carteMarche(candles, meta) {
  let st = null;
  try { st = Structure.analyze(candles, meta); } catch { return null; }
  const prix = st.lastPrice;
  const atr = Number.isFinite(st.atr14) && st.atr14 > 0 ? st.atr14 : null;

  // Zones exploitables, avec leur distance au prix en ATR (seule unité comparable
  // d'un actif à l'autre : 40 points d'écart ne veulent pas dire la même chose
  // sur le BTC et sur le R_75).
  const zones = [];
  const pousser = (type, sens, low, high, origine) => {
    if (!Number.isFinite(low) || !Number.isFinite(high)) return;
    const centre = (low + high) / 2;
    const dist = atr ? Math.abs(prix - centre) / atr : null;
    const dedans = prix >= low && prix <= high;
    zones.push({ type, sens, low: r2(low), high: r2(high), centre: r2(centre),
      distanceAtr: r2(dist), dansLaZone: dedans, origine });
  };
  for (const f of st.fvgs || []) pousser(`FVG ${f.type}`, f.type === 'bullish' ? 'long' : 'short', f.low, f.high, 'FVG');
  for (const o of st.orderBlocks || []) pousser(`OB ${o.type}`, o.type === 'bullish' ? 'long' : 'short', o.low, o.high, 'Order block');
  for (const b of st.breakers || []) {
    const haussier = String(b.type).includes('haussier');
    pousser(b.type, haussier ? 'long' : 'short', b.low, b.high, 'Breaker');
  }
  zones.sort((a, b) => (a.distanceAtr ?? 99) - (b.distanceAtr ?? 99));

  const ev = st.structure && st.structure.event ? st.structure.event : null;
  return {
    // Le timeframe fait partie de la carte : les signaux structurels s'en servent,
    // et lisaient `carte.timeframe` sans qu'il existe → `tf: null` partout.
    symbol: st.symbol || null,
    timeframe: st.timeframe || null,
    tendance: st.structure ? st.structure.trend : null,
    evenement: ev ? { type: ev.type, sens: ev.direction === 'bullish' ? 'long' : 'short', niveau: r2(ev.level) } : null,
    pointsReperes: st.structure ? st.structure.recent : [],
    position: st.premiumDiscount ? {
      zone: st.premiumDiscount.position,
      equilibre: st.premiumDiscount.equilibrium,
      bas: st.premiumDiscount.low, haut: st.premiumDiscount.high,
      ote: st.premiumDiscount.ote
    } : null,
    zones,
    zoneLaPlusProche: zones.length ? zones[0] : null,
    liquidite: (st.liquidity || []).map(p => ({
      type: p.type, prix: p.price,
      distanceAtr: atr ? r2(Math.abs(prix - p.price) / atr) : null,
      auDessus: p.price > prix
    })),
    balayages: st.sweeps || [],
    deplacements: st.displacements || [],
    niveauxPrecedents: st.previousLevels || null,
    session: st.sessions ? { courante: st.sessions.sessionCourante, killZone: st.sessions.killZone } : null,
    atr: atr ? r2(atr) : null,
    prix: r2(prix)
  };
}

/**
 * Contexte structurel d'un signal : ce que le MARCHÉ dit de ce sens, à cet
 * endroit, maintenant. Rend un score d'ajustement et des conditions lisibles.
 */
function contextePour(sens, carte) {
  if (!carte || !sens || sens === 'neutre') return null;
  const c = [];
  let score = 0;
  const ajouter = (nom, valeur, seuil, ok, poids) => {
    c.push({ nom, valeur, seuil, ok });
    if (ok) score += poids;
  };

  // 1. Tendance de fond : un signal contre la tendance n'est pas interdit, il est
  //    plus fragile — le score le dit au lieu de le taire.
  if (carte.tendance && carte.tendance !== 'range') {
    const haussier = carte.tendance === 'bullish';
    const avec = (sens === 'long') === haussier;
    ajouter('tendance de fond', haussier ? 'haussière' : 'baissière',
      avec ? 'avec le sens du signal' : 'contre le sens du signal', avec, 0.15);
    if (!avec) score -= 0.15;
  } else if (carte.tendance === 'range') {
    c.push({ nom: 'tendance de fond', valeur: 'range', seuil: 'hors range', ok: false });
  }

  // 2. Position dans le range : on achète en discount, on vend en premium.
  if (carte.position && carte.position.zone) {
    const fav = (sens === 'long' && carte.position.zone === 'discount')
      || (sens === 'short' && carte.position.zone === 'premium');
    ajouter('position dans le range', carte.position.zone,
      sens === 'long' ? 'discount' : 'premium', fav, 0.08);
    if (!fav) score -= 0.08;
  }

  // 3. Zone d'entrée : être DANS une zone qui va dans le sens du signal, ou juste
  //    à côté, vaut mieux qu'un signal au milieu de nulle part.
  const z = carte.zoneLaPlusProche;
  if (z) {
    const proche = Number.isFinite(z.distanceAtr) && z.distanceAtr <= 0.8;
    const compatible = z.sens === sens;
    ajouter('zone la plus proche', `${z.type} à ${z.distanceAtr} ATR`,
      '≤ 0.8 ATR et dans le sens', proche && compatible, 0.10);
    if (proche && !compatible) score -= 0.08;   // on entre dans une zone opposée
  }

  // 4. Liquidité : savoir où sont les stops change la lecture d'une entrée.
  const liq = (carte.liquidite || [])
    .filter(l => Number.isFinite(l.distanceAtr))
    .sort((a, b) => a.distanceAtr - b.distanceAtr)[0];
  if (liq) {
    const devant = sens === 'long' ? liq.auDessus : !liq.auDessus;
    ajouter('liquidité la plus proche', `${liq.type} à ${liq.distanceAtr} ATR`,
      devant ? 'sur le chemin du signal' : 'à contre-sens', devant && liq.distanceAtr <= 1.5, 0.04);
  }

  // 5. Déplacement dans le sens du signal : signature d'une entrée réelle.
  const dep = (carte.deplacements || []).slice(-3)
    .filter(d => (sens === 'long' ? d.direction === 'haussier' : d.direction === 'baissier'));
  if (dep.length) {
    ajouter('déplacement récent', `${dep.length} bougie(s) ≥ 1,5 × ATR`, 'dans le sens', true, 0.05);
  }

  score = Math.max(-0.25, Math.min(0.25, score));
  const favorables = c.filter(x => x.ok).length;
  const defavorables = c.length - favorables;
  return {
    conditions: c,
    ajustement: +score.toFixed(3),
    favorables, defavorables,
    alignement: carte.tendance
      ? ((sens === 'long') === (carte.tendance === 'bullish') ? 'avec la tendance' : 'contre la tendance')
      : 'tendance indécise',
    position: carte.position ? carte.position.zone : null,
    zone: z ? z.type : null,
    lecture: [
      carte.tendance ? `tendance ${carte.tendance}` : null,
      carte.position ? `prix en ${carte.position.zone}` : null,
      z ? `${z.type} à ${z.distanceAtr} ATR` : null,
      // Le NET, pas seulement le nombre de critères favorables : trois critères
      // favorables peuvent être annulés par une tendance contraire, et l'écran ne
      // doit pas laisser croire que la structure soutient le signal.
      `${favorables}/${c.length} favorable(s), net ${score >= 0 ? '+' : ''}${score.toFixed(2)}`
    ].filter(Boolean).join(' · ')
  };
}


// ─────────────────────────────────────────────────────────────
// SIGNAUX DE STRUCTURE — la lecture du marché elle-même
// ─────────────────────────────────────────────────────────────
/**
 * Signaux issus de la STRUCTURE, pas d'une figure : cassure de structure,
 * changement de caractère, balayage de liquidité, retour sur zone (OB/FVG),
 * amas de stops, extrême du range.
 *
 * Ce sont les signaux qu'un trader lit en premier — avant les bougies. Les passer
 * sous silence parce qu'ils ne viennent pas d'une « stratégie » de la base
 * revenait à cacher la moitié du marché.
 */
function signauxStructure(carte, candles) {
  if (!carte) return [];
  const out = [];
  const atr = carte.atr;
  const prix = carte.prix;
  const dernier = candles && candles.length ? candles[candles.length - 1] : null;
  if (!Number.isFinite(prix)) return out;

  const a = Number.isFinite(atr) ? atr : 0;

  const niveaux = (sens, stop, obj1, obj2) => {
    const brut = {
      entree: arrondiPrix(prix), stop: arrondiPrix(stop),
      objectifs: [arrondiPrix(obj1), arrondiPrix(obj2)].filter(Number.isFinite)
    };
    // Même garde que pour les motifs : pas de stop à moins de 0,5 ATR, pas de
    // stop du mauvais côté. Une seule règle pour tous les émetteurs de niveaux.
    const n = assainirNiveaux(brut, sens, a);
    if (!n) return { entree: null, stop: null, objectifs: [], rr: null };
    const risque = Math.abs(n.entree - n.stop);
    const o1 = n.objectifs[0];
    return {
      ...n,
      rr: risque > 0 && Number.isFinite(o1)
        ? +((Math.abs(o1 - n.entree) / risque).toFixed(2)) : null
    };
  };

  // 1. BOS / CHoCH — cassure de structure confirmée par la clôture.
  if (carte.evenement && Number.isFinite(carte.evenement.niveau)) {
    const { type, sens, niveau } = carte.evenement;
    const long = sens === 'long';
    const n = niveaux(sens,
      long ? niveau - a * 0.5 : niveau + a * 0.5,
      long ? prix + a : prix - a,
      long ? prix + a * 2 : prix - a * 2);
    out.push({
      id: `structure:${type.toLowerCase()}`,
      source: 'structure',
      nom: `${type} ${long ? 'haussier' : 'baissier'}`,
      strategie: null, concept: 'Structure de marché',
      tf: carte.timeframe || null, sens,
      status: 'confirme', force: 0.72,
      conditions: [
        { nom: 'niveau cassé', valeur: r2(niveau), seuil: long ? 'clôture au-dessus' : 'clôture en dessous', ok: true },
        { nom: 'clôture', valeur: r2(prix), seuil: long ? `> ${r2(niveau)}` : `< ${r2(niveau)}`, ok: true },
        { nom: 'type', valeur: type, seuil: type === 'BOS' ? 'continue la tendance' : 'retourne la tendance', ok: true }
      ],
      preuves: [`${type} au niveau ${r2(niveau)}, clôture ${r2(prix)}`],
      ...n, base: null,
      raison: type === 'BOS' ? 'la structure continue dans le sens de la tendance' : 'la structure s\'inverse : premier signe de retournement'
    });
  }

  // 2. Balayage de liquidité récent — mèche au-delà d'un swing puis retour.
  const balayages = (carte.balayages || []).filter(b => dernier && b.at === dernier.t);
  if (balayages.length) {
    const b = balayages[balayages.length - 1];
    const long = b.type === 'balayage bas';       // on a pris les stops sous un creux → retour haussier
    const sens = long ? 'long' : 'short';
    const n = niveaux(sens,
      long ? b.extreme - a * 0.3 : b.extreme + a * 0.3,
      long ? prix + a : prix - a,
      long ? prix + a * 2 : prix - a * 2);
    out.push({
      id: 'structure:sweep',
      source: 'structure',
      nom: `Balayage de liquidité ${long ? 'haussier' : 'baissier'}`,
      strategie: null, concept: 'Liquidité',
      tf: carte.timeframe || null, sens,
      status: (b.reclaimed ? 'confirme' : 'surveiller'), force: 0.68,
      // Les conditions qui DÉFINISSENT un balayage sont marquées obligatoires :
      // sans elles ce n'est pas un balayage, c'est une mèche. Le statut
      // « confirme » pouvait être posé alors que « niveau repris » était faux —
      // la définition du setup contredisait son propre statut.
      conditions: [
        { nom: 'niveau balayé', valeur: r2(b.level), seuil: 'dépassé en mèche', ok: true, obligatoire: true },
        { nom: 'extrême atteint', valeur: r2(b.extreme), seuil: '—', ok: true, obligatoire: true },
        { nom: 'niveau repris', valeur: b.reclaimed ? 'oui' : 'non', seuil: 'clôture revenue du bon côté', ok: !!b.reclaimed, obligatoire: true },
        { nom: 'profondeur', valeur: `${b.depth} %`, seuil: '> 0', ok: b.depth > 0, obligatoire: false }
      ],
      preuves: [`${b.type} à ${r2(b.level)} (extrême ${r2(b.extreme)}, ${b.depth} %)`],
      ...n, base: null,
      raison: 'les stops au-delà du niveau ont été pris ; la clôture est revenue, ce qui retourne la lecture'
    });
  }

  // 3. Retour sur zone : le prix est DANS un order block ou un FVG encore ouvert.
  const dans = (carte.zones || []).filter(z => z.dansLaZone);
  for (const z of dans.slice(0, 2)) {
    const long = z.sens === 'long';
    const n = niveaux(z.sens,
      long ? z.low - a * 0.3 : z.high + a * 0.3,
      long ? prix + a : prix - a,
      long ? prix + a * 2 : prix - a * 2);
    out.push({
      id: `structure:retest-${z.origine.toLowerCase().replace(/\s/g, '-')}-${long ? 'long' : 'short'}`,
      source: 'structure',
      nom: `Retour sur ${z.type}`,
      strategie: null, concept: z.origine,
      tf: carte.timeframe || null, sens: z.sens,
      status: 'surveiller', force: 0.6,
      conditions: [
        { nom: 'zone', valeur: `${r2(z.low)}–${r2(z.high)}`, seuil: `prix ${r2(prix)} dans la zone`, ok: true },
        { nom: 'distance', valeur: `${z.distanceAtr} ATR`, seuil: '≤ 0.8 ATR', ok: Number.isFinite(z.distanceAtr) && z.distanceAtr <= 0.8 }
      ],
      preuves: [`prix dans ${z.type} (${r2(z.low)}–${r2(z.high)})`],
      ...n, base: null,
      raison: 'zone encore valide : c\'est un point d\'entrée potentiel, pas encore un déclenchement'
    });
  }

  // 4. Amas de stops (EQH/EQL) — une cible, pas une direction.
  const liq = (carte.liquidite || [])
    .filter(l => Number.isFinite(l.distanceAtr) && l.distanceAtr <= 0.6)
    .sort((x, y) => x.distanceAtr - y.distanceAtr)[0];
  if (liq) {
    out.push({
      id: 'structure:liquidite',
      source: 'structure',
      nom: `Amas de stops ${liq.type}`,
      strategie: null, concept: 'Liquidité',
      tf: carte.timeframe || null, sens: liq.auDessus ? 'short' : 'long',
      status: 'surveiller', force: 0.55,
      conditions: [
        { nom: 'niveau', valeur: r2(liq.prix), seuil: `prix ${r2(prix)}`, ok: true },
        { nom: 'distance', valeur: `${liq.distanceAtr} ATR`, seuil: '≤ 0.6 ATR', ok: true },
        { nom: 'position', valeur: liq.auDessus ? 'au-dessus du prix' : 'sous le prix', seuil: 'cible probable', ok: true }
      ],
      preuves: [`${liq.type} à ${r2(liq.prix)}, à ${liq.distanceAtr} ATR`],
      entree: null, stop: null, objectifs: [r2(liq.prix)], rr: null, base: null,
      raison: 'les stops accumulés attirent le prix : c\'est une cible, pas un sens d\'entrée à lui seul'
    });
  }

  // 5. Extrême du range : ni achat ni vente, mais « ne pas entrer ici ».
  const pos = carte.position;
  if (pos && Number.isFinite(pos.haut) && Number.isFinite(pos.bas) && pos.haut > pos.bas) {
    const part = (prix - pos.bas) / (pos.haut - pos.bas);
    if (part >= 0.85 || part <= 0.15) {
      const haut = part >= 0.85;
      out.push({
        id: 'structure:range-extreme',
        source: 'structure',
        nom: `Extrême de range (${haut ? 'premium' : 'discount'})`,
        strategie: null, concept: 'Premium / Discount',
        tf: carte.timeframe || null, sens: 'neutre',
        status: 'surveiller', force: 0.5,
        conditions: [
          { nom: 'position dans le range', valeur: `${Math.round(part * 100)} %`, seuil: haut ? '≥ 85 %' : '≤ 15 %', ok: true },
          { nom: 'range', valeur: `${r2(pos.bas)}–${r2(pos.haut)}`, seuil: `équilibre ${r2(pos.equilibre)}`, ok: true }
        ],
        preuves: [`prix à ${Math.round(part * 100)} % du range du dernier swing`],
        entree: null, stop: null, objectifs: [], rr: null, base: null,
        raison: haut
          ? 'prix au sommet du range : acheter ici, c\'est acheter le haut. Attends un retour vers l\'équilibre.'
          : 'prix au plancher du range : vendre ici, c\'est vendre le bas. Attends un retour vers l\'équilibre.'
      });
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────
// PORTES DU RAPPORT RISQUE/RENDEMENT
// ─────────────────────────────────────────────────────────────
/**
 * Refuse les signaux dont l'objectif ne peut pas être atteint.
 *
 * Trois motifs de refus, tous mesurés :
 *   • objectif inutilisable (rr nul, ≤ 0, inconnu) — 9 % des trades de R_75 1h ;
 *   • rr sous le minimum demandé (`rrMin`), quand l'appelant l'active ;
 *   • objectif IRRÉALISTE sur un signal de STRATÉGIE (`rrMaxStrategie`, défaut 2).
 *
 * Le troisième est né d'une mesure : sur NQ=F quotidien, 10 ans, frais et
 * glissement inclus, les signaux de stratégie sortent avec un rr moyen de 4,64
 * (motifs : 1,41) et 62 % d'entre eux dépassent 2. Cette tranche vaut
 * **−0,467 R sur 221 trades**, quand rr 0,5–1,5 vaut +0,28. Après plafond à 2,
 * la source passe de −0,2033 à +0,1130 R.
 *
 * On ne l'applique PAS aux motifs : chez eux la tranche rr ≥ 2 est POSITIVE
 * (+0,117 R sur 535 trades). Le défaut n'est pas « viser loin », c'est de viser
 * loin avec un stop trop serré — propre aux niveaux des stratégies.
 *
 * Mute les signaux refusés (niveaux retirés, statut dégradé) et rend la liste
 * des refus avec le chiffre qui les explique.
 */
function portesRR(signaux, options = {}) {
  const rrMin = Number.isFinite(Number(options.rrMin)) ? Number(options.rrMin) : 0;
  const rrMaxStrategie = Number.isFinite(Number(options.rrMaxStrategie))
    ? Number(options.rrMaxStrategie) : 2;
  const ecartesRR = [];

  for (const s of signaux) {
    if (s.entree === null || s.stop === null) continue;
    // ⚠️ `Number(null)` vaut 0 : sans ce test, un signal sans objectif passait
    // pour un rr de zéro. Règle de cohérence, PAS un réglage : un trade dont
    // l'objectif est au niveau de l'entrée ne peut rien gagner.
    const brut = s.rr;
    const rr = (brut === null || brut === undefined) ? null : Number(brut);
    const tropFaible = rr !== null && Number.isFinite(rr) && rr > 0 && rrMin > 0 && rr < rrMin;
    const invalide = rr === null || !Number.isFinite(rr) || rr <= 0;
    const tropLoin = s.source === 'strategie' && rrMaxStrategie > 0
      && rr !== null && Number.isFinite(rr) && rr > rrMaxStrategie;
    if (!invalide && !tropFaible && !tropLoin) continue;

    const motif = invalide
      ? `objectif inutilisable : rapport risque/rendement ${rr === null || !Number.isFinite(rr) ? 'inconnu' : rr.toFixed(2)} (aucun gain possible)`
      : tropFaible
        ? `rapport risque/rendement ${rr.toFixed(2)} < ${rrMin} exigé`
        : `objectif irréaliste : ${rr.toFixed(2)} fois le risque, plafond ${rrMaxStrategie} `
          + 'pour une stratégie (mesuré : cette tranche vaut −0,47 R par trade)';

    const refus = { id: s.id, nom: s.nom, source: s.source, sens: s.sens,
      rr: (rr !== null && Number.isFinite(rr)) ? rr : null, rrMin, invalide, raison: motif };
    ecartesRR.push(refus);
    s.ecarteRR = refus;
    s.entree = null;
    s.stop = null;
    s.objectifs = [];
    s.rr = null;
    s.raison = [s.raison, motif].filter(Boolean).join(' — ');
    if (s.status === 'confirme') s.status = 'surveiller';
  }
  return ecartesRR;
}

// ─────────────────────────────────────────────────────────────
// POINT D'ENTRÉE
// ─────────────────────────────────────────────────────────────
/**
 * Évalue TOUT ce que le graphique contient et rend une LISTE de signaux.
 * @param {Array} candles bougies OHLCV (la dernière clôturée en fin de tableau)
 * @param {{symbol?:string, timeframe?:string}} meta
 * @param {{profils?:Array, motifs?:boolean, structure?:boolean}} [options]
 *   profils : liste de profils issus de `Signals.profilDepuisStrategie`
 * @returns {{signaux:Array, synthese:Object, motifs:Object|null, structure:Object|null}}
 */
function detecterTout(candles, meta = {}, options = {}) {
  const profils = Array.isArray(options.profils) ? options.profils.filter(Boolean) : [];
  const avecMotifs = options.motifs !== false;
  const avecStructure = options.structure !== false;

  const signaux = [];

  // 0. Carte de marché : structure, zones, liquidité — calculée UNE seule fois,
  //    puis utilisée comme cadre de lecture par TOUS les signaux.
  const carte = avecStructure ? carteMarche(candles, meta) : null;

  // 1. Un signal PAR stratégie sélectionnée — jamais fusionnées.
  for (const profil of profils) signaux.push(signalStrategie(candles, meta, profil));

  // 2. Un signal PAR motif (rempli ou non : un concept qui ne se déclenche pas
  //    reste visible avec sa raison, sinon le trader croit qu'il n'existe pas).
  let analyseMotifs = null;
  if (avecMotifs) {
    try {
      analyseMotifs = Patterns.analyse(candles);
      if (analyseMotifs.atr) signaux.push(...signauxMotifs(candles, meta, analyseMotifs));
    } catch (e) {
      analyseMotifs = { atr: null, motifs: [], retenus: [], raison: e.message };
    }
  }

  // 3. Lecture de structure : les signaux structurels eux-mêmes (BOS/CHoCH,
  //    balayage, retour sur zone, amas de stops, extrême de range) + le verdict
  //    des 4 règles SMC conservé comme contexte.
  let vStructure = null;
  if (avecStructure) {
    try {
      vStructure = Signals.detect(candles, meta, {});
    } catch { /* le multi-signaux ne doit pas mourir sur le contexte */ }
    try {
      signaux.push(...signauxStructure(carte, candles));
    } catch { /* une carte incomplète ne doit pas vider la liste */ }
  }

  // 4. Contexte structurel appliqué à CHAQUE signal : tendance, position dans le
  //    range, zone la plus proche, liquidité, déplacement. C'est ce qui distingue
  //    un marteau au bon endroit d'un marteau au mauvais endroit.
  if (carte) {
    for (const s of signaux) {
      const ctx = contextePour(s.sens, carte);
      if (!ctx) { s.structureContexte = null; continue; }
      s.structureContexte = ctx;
      const avant = Number(s.force) || 0;
      // Plafond à 0,98 : une force de 1,00 se lit « certitude », un chiffre que le
      // moteur ne peut pas produire (aucun backtest derrière). Le plafond est
      // signalé pour que l'écran ne fasse pas croire à un score naturel.
      const brut = avant + ctx.ajustement;
      const plafonnee = brut > 0.98;
      s.force = +Math.max(0, Math.min(0.98, brut)).toFixed(2);
      s.forceDetail = { avant: r2(avant), ajustement: ctx.ajustement, plafonnee };
      s.conditions = [...(s.conditions || []), ...ctx.conditions];
      // Un signal qui va franchement contre la structure ne peut pas rester
      // « confirmé » : il devient « à surveiller ». La figure est là, le marché
      // ne l'accompagne pas.
      if (s.status === 'confirme' && ctx.ajustement <= -0.10) {
        s.status = 'surveiller';
        s.raison = [s.raison, 'structure défavorable'].filter(Boolean).join(' — ');
      }
    }
  }

  // 4 bis. RÉGIME DE MARCHÉ — l'étage `market-intelligence` existait mais aucun
  // parcours de production ne l'appelait. Mesuré sur 36 séries réelles : 24
  // verdicts directionnels émis dans un régime `ranging` (confiance 0,66–0,93),
  // dont plusieurs « confirmé ». Un range n'a pas de direction : aucun signal
  // directionnel n'y est confirmé. Le signal reste VISIBLE, il redescend à
  // « à surveiller » avec sa raison — il n'est jamais supprimé.
  let regime = null;
  try {
    regime = Regime.detecter(candles, { classe: options.classe || 'inconnu' });
  } catch { /* un régime indisponible ne doit pas bloquer l'analyse */ }
  // Une seule passe : le régime soit RETIRE la confirmation (range), soit la
  // laisse passer en le disant (UNKNOWN). Deux boucles jumelles pour la même
  // intention finissent par diverger.
  const retireConfirmation = !!regime && regime.regime === 'ranging' && (regime.confiance || 0) >= 0.5;
  const noteRegime = retireConfirmation
    ? `régime de range (confiance ${regime.confiance}) : pas de direction confirmée`
    : (regime && regime.regime === 'UNKNOWN'
      ? 'régime indéterminé : signal non filtré par le régime' : null);
  if (noteRegime) {
    for (const s of signaux) {
      if (s.status !== 'confirme') continue;
      if (retireConfirmation) s.status = 'surveiller';
      s.raison = [s.raison, noteRegime].filter(Boolean).join(' — ');
      s.regime = regime.regime;
    }
  }

  // 4 ter. ALIGNEMENT MULTI-UNITÉS — le moteur ne peut pas l'inventer : il ne
  // reçoit qu'UNE série. L'appelant qui l'a calculé (sinon à quoi bon « exiger
  // l'alignement ») le transmet ici, et chaque signal le porte. Sans cette
  // transmission, `s.confluence` restait toujours null : le test d'alignement de
  // DecisionEngine ne s'exécutait JAMAIS, alors que l'écran affichait « 2/3 ».
  if (options.confluence) {
    for (const s of signaux) s.confluence = options.confluence;
  }

  // 5. PLAFOND DE COÛT — un risque plus petit que les frais n'est pas un trade.
  //    Un seul point d'application, comme pour la confluence : tous les émetteurs
  //    de niveaux (motifs, structure, stratégies) passent ici.
  //    Les signaux ne sont PAS supprimés : ils restent dans la liste, sans
  //    niveaux, avec le chiffre qui explique le refus. Un trade qui disparaît
  //    en silence laisse croire que le moteur n'a rien vu.
  const ecartesFrais = [];
  for (const s of signaux) {
    const verdict = Frais.plafondCout(s.entree, s.stop, meta.symbol);
    if (!verdict || verdict.ok) continue;
    ecartesFrais.push({
      id: s.id, nom: s.nom, source: s.source, sens: s.sens,
      cout: verdict.cout, risque: verdict.risque, enR: verdict.enR,
      part: verdict.part, partMax: verdict.partMax, exigence: verdict.exigence,
      raison: verdict.raison
    });
    s.ecarteFrais = verdict;
    s.entree = null;
    s.stop = null;
    s.objectifs = [];
    s.rr = null;
    s.raison = [s.raison, verdict.raison].filter(Boolean).join(' — ');
    // Le statut d'un signal sans niveaux ne peut plus être « confirmé » : on
    // garde le statut de lecture mais on l'annote, sinon l'écran annonce un
    // trade que le moteur vient de refuser.
    if (s.status === 'confirme') s.status = 'surveiller';
  }

  // 5 bis. RAPPORT RISQUE/RENDEMENT — mesuré, pas supposé.
  //    Analyse des 110 000 trades du jeu de données, par tranche de rr :
  //      rr 0,25-0,5 : XAU 15m **−0,027 R** (479 trades), R_75 15m **−0,073 R**
  //                    (359), XAU 5m +0,018, R_75 5m +0,004 — nul ou négatif.
  //      rr 0,75-1   : +0,10 à +0,14 R
  //      rr 1,5-2    : +0,16 à +0,30 R  ← la tranche qui paie
  //    Le marché ne rémunère pas les objectifs trop proches : gagner souvent ne
  //    compense pas la perte rare quand l'objectif vaut moins que le risque.
  //    Un seul point d'application, comme les frais et le modèle : la fonction
  //    `portesRR`, exportée pour être testée seule.
  const ecartesRR = portesRR(signaux, options);

  // 6. LE MODÈLE PONDÈRE — R attendu.
  //    Les règles disent POURQUOI un signal existe ; le modèle dit COMBIEN il
  //    vaut, en R, d'après 6 mois et ~98 000 trades. Il ne remplace pas les
  //    règles : il refuse ce dont l'espérance est négative, et il note le reste.
  //    Un marché absent du modèle ne reçoit AUCUNE note (pas d'extrapolation) et
  //    n'est donc jamais filtré par lui.
  const modeleDispo = options.modele !== false && Modele.disponible();
  const ecartesModele = [];
  // Seuil d'acceptation : 0 = on ne refuse que l'espérance négative.
  // `options.modeleSeuil` / MODELE_SEUIL='top10' applique le décile supérieur
  // validé en walk-forward — au prix de ~90 % de signaux en moins.
  const seuilModele = Number.isFinite(Number(options.modeleSeuil))
    ? Number(options.modeleSeuil)
    : Modele.seuil();
  if (modeleDispo) {
    for (const s of signaux) {
      // Un signal déjà écarté (coût) n'a plus de niveaux : rien à noter.
      if (s.entree === null || s.stop === null) continue;
      const note = Modele.noter(s, meta.symbol, carte);
      if (!note) continue;
      note.seuil = seuilModele;
      s.modele = note;
      if (note.horsPerimetre || note.rAttendu === null) continue;
      if (note.rAttendu >= seuilModele) continue;

      const motifRefus = seuilModele > 0
        ? `sous le seuil (${note.rAttendu} R attendu < ${seuilModele} R exigé, modèle v${note.version} sur ${note.marche})`
        : `espérance négative (${note.rAttendu} R attendu, modèle v${note.version} sur ${note.marche})`;
      ecartesModele.push({
        id: s.id, nom: s.nom, source: s.source, sens: s.sens,
        rAttendu: note.rAttendu, seuil: seuilModele,
        marche: note.marche, version: note.version, raison: motifRefus
      });
      s.ecarteModele = note;
      s.entree = null;
      s.stop = null;
      s.objectifs = [];
      s.rr = null;
      s.raison = [s.raison, motifRefus].filter(Boolean).join(' — ');
      if (s.status === 'confirme') s.status = 'surveiller';
    }
  }

  // Tri : confirmés d'abord, puis surveiller, puis non remplis ; à statut égal,
  // le R ATTENDU décroissant (ce qui vaut le plus passe en tête), puis la force.
  // Trier par force seule mettait en avant un signal « solide » que le modèle
  // juge perdant : c'est l'espérance qui décide de l'ordre de lecture.
  const ordre = { confirme: 0, surveiller: 1, 'rejete': 2, erreur: 3 };
  // Sentinelle finie : `-Infinity - -Infinity` vaut NaN et un comparateur NaN
  // laisse l'ordre indéterminé.
  const rAtt = s => (s.modele && Number.isFinite(s.modele.rAttendu) ? s.modele.rAttendu : -999);
  signaux.sort((a, b) =>
    (ordre[a.status] ?? 9) - (ordre[b.status] ?? 9)
    || rAtt(b) - rAtt(a)
    || (b.force || 0) - (a.force || 0));

  // 7. CONTRAT DE SORTIE — les trois émetteurs (stratégie, motif, structure) sont
  //    ramenés à la même forme et VALIDÉS avant publication. Un signal hors
  //    contrat reste visible (le faire disparaître laisserait croire que le
  //    marché n'a rien dit) mais il porte `contrat.ok = false` + la raison, et
  //    DecisionEngine refuse de l'exécuter.
  const horsContrat = [];
  for (const s of signaux) {
    const v = Contrat.validerSignal(s);
    s.contrat = v;
    if (!v.ok) horsContrat.push({ id: s.id, nom: s.nom, source: s.source, manquants: v.manquants, invalides: v.invalides });
  }

  const retenus = signaux.filter(s => s.status === 'confirme' || s.status === 'surveiller');
  const synthese = {
    total: signaux.length,
    confirmes: signaux.filter(s => s.status === 'confirme').length,
    aSurveiller: signaux.filter(s => s.status === 'surveiller').length,
    rejetes: signaux.filter(s => s.status === 'rejete').length,
    erreurs: signaux.filter(s => s.status === 'erreur').length,
    long: retenus.filter(s => s.sens === 'long').length,
    short: retenus.filter(s => s.sens === 'short').length,
    neutre: retenus.filter(s => s.sens === 'neutre').length,
    // Les stratégies évaluées, nommées : c'est ce que le trader a sélectionné.
    strategiesEvaluees: [...new Set(signaux.filter(s => s.source === 'strategie').map(s => s.nom))],
    // D'où viennent les signaux : une stratégie, un motif de bougie, ou la
    // structure du marché elle-même. Le trader voit ainsi la composition.
    parSource: {
      strategies: signaux.filter(s => s.source === 'strategie').length,
      motifs: signaux.filter(s => s.source === 'motif').length,
      structure: signaux.filter(s => s.source === 'structure').length
    },
    // Combien de signaux ont été refusés parce que le coût dépasse le risque :
    // le trader doit voir que le marché est tradable ou non, pas le deviner.
    ecartesFrais: ecartesFrais.length,
    // Idem pour le modèle : combien de configurations ont une espérance négative.
    ecartesModele: ecartesModele.length,
    // Combien de configurations refusées parce que l'objectif ne valait pas le
    // risque : c'est un refus de construction, pas de marché.
    ecartesRR: ecartesRR.length,
    // Contrat de sortie : combien de signaux respectent la forme commune.
    contrat: {
      version: Contrat.CONTRAT.version,
      valides: signaux.length - horsContrat.length,
      invalides: horsContrat.length,
      details: horsContrat.slice(0, 10)
    },
    rrMin: Number.isFinite(Number(options.rrMin)) ? Number(options.rrMin) : 0,
    rrMaxStrategie: Number.isFinite(Number(options.rrMaxStrategie))
      ? Number(options.rrMaxStrategie) : 2,
    modele: modeleDispo
      ? { disponible: true, version: (Modele.modele() || {}).version || 1, marches: Modele.marches() }
      : { disponible: false, version: null, marches: [] },
    // Le marché parle-t-il d'une seule voix ? Compte des signaux RETENUS par sens.
    biais: (() => {
      const l = retenus.filter(s => s.sens === 'long').length;
      const v = retenus.filter(s => s.sens === 'short').length;
      if (!l && !v) return 'aucun';
      if (l > v) return `haussier (${l} vs ${v})`;
      if (v > l) return `baissier (${v} vs ${l})`;
      return `partagé (${l} / ${v})`;
    })()
  };

  return {
    at: candles && candles.length ? candles[candles.length - 1].t : null,
    symbol: meta.symbol || null,
    timeframe: meta.timeframe || null,
    // Régime mesuré (trending / ranging / volatil / UNKNOWN) : l'écran doit
    // pouvoir dire POURQUOI un signal confirmé est redescendu à surveiller.
    regime: regime || null,
    price: candles && candles.length ? candles[candles.length - 1].c : null,
    atr: analyseMotifs ? analyseMotifs.atr : (vStructure ? vStructure.atr : null),
    signaux,
    synthese,
    // La carte de marché : tendance, BOS/CHoCH, premium/discount, zones, liquidité.
    // L'écran l'affiche en tête, avant la liste des signaux.
    carte,
    motifs: analyseMotifs,
    structure: vStructure,
    // Le détail de ce que les frais ont fait écarter, avec les chiffres.
    ecartesFrais,
    // Et ce que le modèle a refusé, avec son R attendu.
    ecartesModele,
    // Et ce que le rapport risque/rendement a refusé, avec le chiffre.
    ecartesRR
  };
}

module.exports = {
  detecterTout, signalStrategie, signauxMotifs, conditionsMotif,
  niveauxMotif, rrDe, sensDe, statutDe,
  carteMarche, contextePour, signauxStructure,
  // Garde des niveaux, exportée pour être testée seule : c'est le point unique
  // où l'on garantit « pas de risque nul, pas de stop à contre-sens ».
  assainirNiveaux, arrondiPrix, portesRR
};
