/**
 * 5trade — APPRENTISSAGE : rejeu par le cerveau réel.
 *
 * Le rejeu historique du dépôt (`rejoueur-journalier.js`) ne partageait RIEN avec
 * le moteur qui trade :
 *   - son « POC » était la médiane des plus bas, pas un niveau de structure ;
 *   - il ne testait que des longs ;
 *   - ses R étaient des constantes (1,27 / 2,0), pas des sorties mesurées ;
 *   - il n'appliquait aucun frais ni spread.
 * Conclusion : l'apprentissage mesurait un autre système que celui qui décide.
 * Un système qui apprend sur un autre que lui-même n'apprend rien.
 *
 * Ce module rejoue avec LES MÊMES modules que le direct :
 *   `engine/structure`        → niveaux, FVG, order blocks, liquidité
 *   `scenarios/generateur`    → les scénarios, tels quels
 *   `gestion/killzones`       → les mêmes fenêtres horaires
 *   `core/frais`              → le coût réel, en R
 *
 * La gestion simulée applique le plan du dépôt : TP1 50 %, stop à l'entrée,
 * TP2 30 %, runner 20 % sous trailing 1,5 ATR, invalidation temporelle à 180 min.
 * Aucune issue n'est supposée favorable : dans une bougie qui touche le stop ET
 * un objectif, le stop est retenu (hypothèse pessimiste, donc honnête).
 */

const Structure = require('../engine/structure');
const Generateur = require('../scenarios/generateur');
const Killzones = require('../gestion/killzones');
const Frais = require('../core/frais');
const Regime = require('../market-intelligence/regime-detector');
const ATR = require('../atr-unifie');

const PARTIELS = [
  { niveau: 'tp1', pct: 50 },
  { niveau: 'tp2', pct: 30 }
];
const PCT_RUNNER = 20;
const HORIZON_MS = 4 * 3600 * 1000;

const arrondi = (x, n = 6) => (Number.isFinite(x) ? +Number(x).toFixed(n) : null);

/**
 * Rejoue une série historique pour un instrument.
 *
 * @param {object} p
 * @param {string} p.instrument
 * @param {Array}  p.h1        bougies H1 (structure, scénarios)
 * @param {Array}  p.m5        bougies M5 (déclenchement, gestion)
 * @param {object} [p.seuils]  seuils appris (ajusteur-seuils)
 * @param {object} [p.options] { horizonMs, killzoneObligatoire, coutEnR }
 *   `coutEnR(instrument, entree, risque)` permet d'injecter une grille de frais
 *   (test ou courtier précis) ; par défaut : `core/frais`, la grille réelle.
 * @returns {{trades:Array, metrics:object, motifs:Array<string>}}
 */
function rejouer({ instrument, h1, m5, seuils = {}, options = {} } = {}) {
  const motif = [];
  const serieH1 = (h1 || [])
    .filter(c => c && c.closed !== false && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c))
    .sort((a, b) => a.t - b.t);
  const serieM5 = (m5 || [])
    .filter(c => c && c.closed !== false && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c))
    .sort((a, b) => a.t - b.t);

  if (serieH1.length < 80) return vide(`${serieH1.length} bougies H1 < 80 : pas de structure mesurable`);
  if (serieM5.length < 100) return vide(`${serieM5.length} bougies M5 < 100 : pas de déclenchement mesurable`);

  const horizonMs = Number(options.horizonMs) > 0 ? Number(options.horizonMs) : HORIZON_MS;
  const killzoneObligatoire = options.killzoneObligatoire !== false;
  const trades = [];
  const rejets = { hors_killzone: 0, non_declenche: 0, chevauchement: 0, sans_scenario: 0 };
  let derniereSortieT = 0;

  for (let i = 60; i < serieH1.length; i++) {
    const tranche = serieH1.slice(0, i + 1);
    const bougie = serieH1[i];

    let generation;
    try {
      generation = Generateur.generer(tranche, { symbol: instrument, timeframe: '1h' },
        { tp1R: seuils.tp1_r, tp2R: seuils.tp2_r });
    } catch (e) {
      rejets.sans_scenario++;
      continue;
    }
    if (!generation || !Array.isArray(generation.scenarios) || !generation.scenarios.length) {
      rejets.sans_scenario++;
      continue;
    }

    let regime = 'inconnu';
    try {
      const r = Regime.detecter(tranche);
      regime = (r && r.regime) || 'inconnu';
    } catch { /* régime non mesurable : on le dit, on ne l'invente pas */ }

    const atr = Number(generation.atr) || ATR.atr(tranche, 14);

    for (const scenario of generation.scenarios) {
      const long = scenario.direction === 'long';
      const entree = Number(scenario.niveauEntree);
      const stop0 = Number(scenario.stop);
      if (!Number.isFinite(entree) || !Number.isFinite(stop0) || !Number.isFinite(Number(scenario.tp1))) continue;
      const risque = Math.abs(entree - stop0);
      if (!(risque > 0)) continue;

      // Fenêtre de validité du plan : TTL du scénario, borné par l'horizon.
      const ttl = Number(scenario.ttlMs) > 0 ? Number(scenario.ttlMs) : 3 * 3600 * 1000;
      const finValidite = bougie.t + Math.min(ttl, horizonMs);
      const fenetre = serieM5.filter(c => c.t > bougie.t && c.t <= finValidite);
      if (!fenetre.length) { rejets.non_declenche++; continue; }

      // Déclenchement : le prix ATTEINT le niveau (ordre limite, pas de chasse).
      const idx = fenetre.findIndex(c => (long ? c.l <= entree : c.h >= entree));
      if (idx < 0) { rejets.non_declenche++; continue; }
      const tEntree = fenetre[idx].t;

      if (tEntree <= derniereSortieT) { rejets.chevauchement++; continue; }

      const kz = Killzones.pour(tEntree);
      if (killzoneObligatoire && !kz) { rejets.hors_killzone++; continue; }

      const sim = simulerGestion({
        suite: serieM5.filter(c => c.t >= tEntree && c.t <= tEntree + horizonMs),
        long, entree, stop0, tp1: Number(scenario.tp1), tp2: Number(scenario.tp2),
        atr, seuils, tEntree
      });
      if (!sim) continue;

      const cout = (typeof options.coutEnR === 'function'
        ? options.coutEnR(instrument, entree, risque)
        : Frais.coutEnR(instrument, entree, risque)) || {};
      const fraisEnR = Number.isFinite(cout.enR) ? cout.enR : null;
      const rBrut = sim.rBrut;
      const rNet = fraisEnR === null ? rBrut : +(rBrut - fraisEnR).toFixed(4);

      derniereSortieT = sim.sortieT;

      trades.push({
        instrument,
        direction: scenario.direction,
        regime,
        killzone: kz || 'hors_session',
        entree_at: new Date(tEntree).toISOString(),
        sortie_at: new Date(sim.sortieT).toISOString(),
        entree: arrondi(entree),
        stop: arrondi(stop0),
        tp1: arrondi(Number(scenario.tp1)),
        tp2: arrondi(Number(scenario.tp2)),
        risque: arrondi(risque),
        issue: sim.issue,
        partiels: sim.partiels,
        r_brut: +rBrut.toFixed(4),
        r_net: rNet,
        frais_r: fraisEnR,
        frais_connus: cout.applique === true,
        duree_min: Math.round((sim.sortieT - tEntree) / 60000),
        atr: arrondi(atr),
        preuves: scenario.preuves || []
      });
    }
  }

  if (!trades.length) {
    motif.push('aucun scénario déclenché et conclu sur la période');
    for (const [k, v] of Object.entries(rejets)) if (v) motif.push(`${v} ${k.replace(/_/g, ' ')}`);
  }

  return { trades, metrics: metricsPour(trades), motifs: motif, rejets };
}

function vide(motif) {
  return { trades: [], metrics: metricsPour([]), motifs: [motif], rejets: {} };
}

/**
 * Simule la gestion post-entrée sur les bougies suivant le déclenchement.
 * Hypothèse pessimiste : dans une même bougie, le stop est traité AVANT les
 * objectifs. Aucune sortie n'est choisie après coup.
 */
function simulerGestion({ suite, long, entree, stop0, tp1, tp2, atr, seuils = {}, tEntree }) {
  if (!suite.length) return null;
  const risque = Math.abs(entree - stop0);
  if (!(risque > 0)) return null;

  const trailingAtr = Number(seuils.trailing_atr) > 0 ? Number(seuils.trailing_atr) : 1.5;
  const invalidationMin = Number(seuils.invalidation_temporelle_minutes) > 0
    ? Number(seuils.invalidation_temporelle_minutes) : 180;
  // En dessous de ce progrès (en R) au terme du délai, la position est jugée
  // immobile et coupée. Au-dessus, elle a le droit d'aller au bout de l'horizon.
  const seuilInvalidationR = Number.isFinite(Number(seuils.invalidation_seuil_r))
    ? Number(seuils.invalidation_seuil_r) : 0.3;

  const rDe = (prix) => ((prix - entree) * (long ? 1 : -1)) / risque;

  let stop = stop0;
  let restantPct = 100;
  let rBrut = 0;
  let tp1Fait = false;
  let tp2Fait = false;
  let delaiVerifie = false;
  let issue = null;
  const partiels = [];
  let sortieT = suite[suite.length - 1].t;

  for (const c of suite) {
    sortieT = c.t;

    // 1. Stop d'abord (pessimiste).
    if (long ? c.l <= stop : c.h >= stop) {
      rBrut += rDe(stop) * (restantPct / 100);
      restantPct = 0;
      issue = partiels.length ? (rBrut >= 0 ? 'breakeven' : 'partiel_puis_stop') : 'stop';
      break;
    }

    // 2. TP1 → 50 % et stop à l'entrée.
    if (!tp1Fait && Number.isFinite(tp1) && (long ? c.h >= tp1 : c.l <= tp1)) {
      rBrut += rDe(tp1) * (PARTIELS[0].pct / 100);
      restantPct = 100 - PARTIELS[0].pct;
      partiels.push('tp1');
      tp1Fait = true;
      stop = long ? Math.max(stop, entree) : Math.min(stop, entree);
      issue = 'tp1';
    }

    // 3. TP2 → 30 %.
    if (tp1Fait && !tp2Fait && Number.isFinite(tp2) && (long ? c.h >= tp2 : c.l <= tp2)) {
      rBrut += rDe(tp2) * (PARTIELS[1].pct / 100);
      restantPct = 100 - PARTIELS[0].pct - PARTIELS[1].pct;
      partiels.push('tp2');
      tp2Fait = true;
      issue = 'tp2';
    }

    // 4. Runner sous trailing ATR (le stop ne recule jamais).
    // Le trailing démarre DÈS le TP1 : entre TP1 et TP2, la part restante (50 %)
    // était auparavant collée au stop d'entrée, donc toute respiration la sortait
    // à 0 R. Un trader qui a sécurisé laisse courir sous trailing, pas sous BE.
    if (tp1Fait && restantPct > 0 && Number.isFinite(atr) && atr > 0) {
      const candidat = long ? c.h - trailingAtr * atr : c.l + trailingAtr * atr;
      stop = long ? Math.max(stop, candidat) : Math.min(stop, candidat);
    }

    // 5. Invalidation temporelle : au-delà du délai, on ne coupe QUE si la
    // position n'a pas progressé. Couper à 180 min une position à +0,9 R qui
    // monte encore était le défaut de la première version : le délai devenait
    // une sortie systématique, et tous les rejeux sortaient « invalidation ».
    if (!tp1Fait && !delaiVerifie && (c.t - tEntree) >= invalidationMin * 60000) {
      delaiVerifie = true;
      const rEnCours = rDe(c.c);
      if (rEnCours < seuilInvalidationR) {
        rBrut += rEnCours * (restantPct / 100);
        restantPct = 0;
        issue = 'invalidation_temporelle';
        break;
      }
    }
  }

  // Fin d'horizon : ce qui reste est soldé au dernier cours connu.
  if (restantPct > 0) {
    const dernier = suite[suite.length - 1];
    rBrut += rDe(dernier.c) * (restantPct / 100);
    if (!issue) issue = 'horizon';
  }

  return { rBrut, issue: issue || 'horizon', partiels, sortieT, pctRestant: restantPct };
}

/**
 * Agrège des trades rejoués. L'espérance est en R NET quand les frais sont
 * connus, et le dit quand ils ne le sont pas (`frais_connus`).
 */
function metricsPour(trades) {
  const liste = Array.isArray(trades) ? trades.filter(t => Number.isFinite(t.r_net)) : [];
  const n = liste.length;
  if (!n) {
    return { n: 0, expectancyR: null, winRate: null, rTotal: 0, fraisConnus: false, parRegime: {}, parKillzone: {}, parDirection: {} };
  }

  const moyenne = (arr) => arr.reduce((a, t) => a + t.r_net, 0) / arr.length;
  const gagnants = liste.filter(t => t.r_net > 0).length;

  const grouper = (cle) => {
    const out = {};
    for (const t of liste) {
      const k = t[cle] || 'inconnu';
      if (!out[k]) out[k] = { n: 0, r: 0, gagnants: 0 };
      out[k].n++;
      out[k].r += t.r_net;
      if (t.r_net > 0) out[k].gagnants++;
    }
    for (const k of Object.keys(out)) {
      out[k].expectancyR = +(out[k].r / out[k].n).toFixed(4);
      out[k].winRate = +((out[k].gagnants / out[k].n) * 100).toFixed(1);
      out[k].r = +out[k].r.toFixed(4);
    }
    return out;
  };

  return {
    n,
    expectancyR: +moyenne(liste).toFixed(4),
    winRate: +((gagnants / n) * 100).toFixed(1),
    rTotal: +liste.reduce((a, t) => a + t.r_net, 0).toFixed(4),
    fraisConnus: liste.every(t => t.frais_connus === true),
    parRegime: grouper('regime'),
    parKillzone: grouper('killzone'),
    parDirection: grouper('direction')
  };
}

/**
 * Candidats d'ajustement produits par le rejeu lui-même.
 *
 * Une seule règle, prudente : un groupe (régime, killzone, direction) dont
 * l'espérance nette est négative sur un échantillon suffisant propose sa
 * désactivation. Le nombre de trades minimum est celui de l'ajusteur : un
 * mauvais jour ne doit pas couper une séance.
 *
 * @returns {Array<{parametre:string, valeurCandidate:any, type:string, motif:string, preuve:object}>}
 */
function candidatsDepuisMetrics(metrics, { minTrades = 20, seuilR = -0.1 } = {}) {
  const out = [];
  if (!metrics || !metrics.n) return out;

  for (const [kz, s] of Object.entries(metrics.parKillzone || {})) {
    if (kz === 'hors_session' || s.n < minTrades) continue;
    if (s.expectancyR < seuilR) {
      out.push({
        type: 'bascule',
        parametre: `killzones.${kz}.actif`,
        valeurCandidate: false,
        motif: `${kz} : ${s.n} trades, espérance ${s.expectancyR} R < ${seuilR} R — coupure proposée`,
        preuve: s
      });
    }
  }

  const regimeRange = (metrics.parRegime && (metrics.parRegime.range || metrics.parRegime.ranging)) || null;
  const asia = (metrics.parKillzone && metrics.parKillzone.asia) || null;
  if (regimeRange && asia && asia.n >= minTrades && asia.expectancyR < seuilR) {
    out.push({
      type: 'bascule',
      parametre: 'killzones.asia.actif_en_range',
      valeurCandidate: false,
      motif: `Asie en range : ${asia.n} trades, espérance ${asia.expectancyR} R — coupure en range proposée`,
      preuve: { asia, range: regimeRange }
    });
  }

  return out;
}

module.exports = {
  rejouer, metricsPour, candidatsDepuisMetrics, simulerGestion,
  PARTIELS, PCT_RUNNER, HORIZON_MS
};
