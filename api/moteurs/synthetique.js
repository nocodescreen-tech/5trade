/**
 * Moteur des indices synthétiques Deriv — Volatility (R_*), 1HZ*, Boom/Crash.
 *
 * Pourquoi un moteur à part : ces instruments ne sont pas des marchés. Leur
 * série est engendrée par un processus aléatoire décrit par Deriv. Un motif
 * chartiste (BOS, order block, sweep) peut y être DESSINÉ — il n'y a personne
 * en face pour le respecter. Appliquer le moteur Forex revient à supposer un
 * comportement de marché qui n'existe pas.
 *
 * Ce que ce moteur mesure, et qui a un sens sur une série synthétique :
 *   - la volatilité réalisée par unité, comparée à sa propre histoire ;
 *   - le z-score du dernier rendement (écart à la moyenne, en écarts-types) ;
 *   - la part des sauts (Boom/Crash : la série est plate puis saute) ;
 *   - le régime statistique (calme / normal / agité) ;
 *   - la vérification que la marche reste compatible avec un processus sans
 *     mémoire : autocorrélation des rendements proche de zéro.
 *
 * Il ne prétend PAS prédire la direction. Il dit si les conditions statistiques
 * rendent une lecture chartiste défendable, et refuse de conclure quand la
 * série est dominée par des sauts ou fortement autocorrélée.
 */

const MOYENNE = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const ECART = xs => {
  const m = MOYENNE(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

/** Rendements logarithmiques successifs. */
function rendements(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) {
    const a = Number(closes[i - 1]), b = Number(closes[i]);
    if (a > 0 && b > 0) r.push(Math.log(b / a));
  }
  return r;
}

/** Autocorrélation d'ordre 1 : ~0 pour une marche aléatoire. */
function autocorrelation1(xs) {
  const n = xs.length;
  if (n < 10) return null;
  const m = MOYENNE(xs);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    den += (xs[i] - m) ** 2;
    if (i) num += (xs[i] - m) * (xs[i - 1] - m);
  }
  return den > 0 ? num / den : null;
}

/**
 * Un saut est un rendement qui dépasse `k` écarts-types. Sur Boom/Crash, ils
 * sont fréquents et concentrent l'essentiel du résultat : c'est la structure du
 * produit, pas un accident.
 */
function partDeSauts(r, k = 4) {
  if (r.length < 20) return null;
  const e = ECART(r);
  if (!(e > 0)) return null;
  const sauts = r.filter(x => Math.abs(x) > k * e).length;
  return sauts / r.length;
}

/**
 * Poids des sauts dans le RÉSULTAT, et non leur nombre.
 *
 * Mesure sur Boom/Crash : 1 à 2 % des bougies dépassent 4 écarts-types. Compter
 * les sauts ne dit donc rien (un seuil à 5 % ne se déclenche jamais, alors que
 * ces quelques bougies font l'essentiel du mouvement). Ce qui compte est la part
 * de variance qu'ils portent : si la moitié du résultat vient de trois bougies,
 * une lecture chartiste décrit un bruit, pas une structure.
 */
function poidsDesSauts(r, k = 4) {
  if (r.length < 20) return null;
  const e = ECART(r);
  if (!(e > 0)) return null;
  const total = r.reduce((a, x) => a + x * x, 0);
  if (!(total > 0)) return null;
  const sauts = r.filter(x => Math.abs(x) > k * e).reduce((a, x) => a + x * x, 0);
  return sauts / total;
}

/**
 * @param {number[]} closes clôtures, de la plus ancienne à la plus récente
 * @param {object} meta { symbol, classe, timeframe }
 * @returns {{moteur, version, famille, statistiques, regime, convient, refus, faits}}
 */
function analyser(closes, meta = {}) {
  const sym = String(meta.symbol || '');
  const prix = (closes || []).map(Number).filter(x => Number.isFinite(x) && x > 0);
  const faits = [];
  const refus = [];

  const famille = /^(BOOM|CRASH)/i.test(sym) ? 'boom-crash'
    : /^JD/i.test(sym) ? 'jump'
      : /^STP/i.test(sym) ? 'step'
        : /^1HZ/i.test(sym) ? 'haute-frequence'
          : 'volatility';

  if (prix.length < 30) {
    return {
      moteur: 'synthetique', version: '1.0.0', famille,
      statistiques: null, regime: 'UNKNOWN', convient: false,
      refus: ['série trop courte : moins de 30 clôtures exploitables'],
      faits: []
    };
  }

  const r = rendements(prix);
  const vol = ECART(r);
  const ac1 = autocorrelation1(r);
  const sauts = partDeSauts(r);
  const poidsSauts = poidsDesSauts(r);
  const dernier = r[r.length - 1];
  const z = vol > 0 ? dernier / vol : null;

  // Volatilité comparée à sa propre histoire : on coupe la série en deux.
  const moitie = Math.max(10, Math.floor(r.length / 2));
  const volDebut = ECART(r.slice(0, moitie));
  const volFin = ECART(r.slice(-moitie));
  const ratioVol = volDebut > 0 ? volFin / volDebut : null;

  let regime = 'normal';
  if (ratioVol !== null && ratioVol > 1.5) regime = 'agite';
  else if (ratioVol !== null && ratioVol < 0.67) regime = 'calme';

  faits.push(`famille ${famille} · ${prix.length} clôtures`);
  faits.push(`volatilité par unité ${(vol * 100).toFixed(4)} %`);
  if (ratioVol !== null) {
    faits.push(`volatilité récente ${(ratioVol * 100).toFixed(0)} % de la première moitié → régime ${regime}`);
  }
  if (z !== null) faits.push(`dernier rendement à ${z.toFixed(2)} écart-type`);
  if (sauts !== null) faits.push(`${(sauts * 100).toFixed(1)} % de rendements au-delà de 4 écarts-types`);
  if (poidsSauts !== null) faits.push(`ces sauts portent ${(poidsSauts * 100).toFixed(0)} % de la variance`);
  if (ac1 !== null) faits.push(`autocorrélation d'ordre 1 : ${ac1.toFixed(3)}`);

  // ── Ce qui rend une lecture chartiste indéfendable ──────────────────────
  if (famille === 'boom-crash' && poidsSauts !== null && poidsSauts > 0.5) {
    refus.push(`produit à sauts : ${(poidsSauts * 100).toFixed(0)} % de la variance vient de quelques bougies — `
      + "une structure de prix n'y décrit pas le résultat");
  }
  if (ac1 !== null && Math.abs(ac1) > 0.25) {
    // Une marche aléatoire donne ~0. Un |ac1| élevé signale une série
    // exploitable en statistique — et rend le motif chartiste trompeur.
    refus.push(`autocorrélation ${ac1.toFixed(2)} : série non conforme à une marche sans mémoire`);
  }
  if (vol === 0) refus.push('volatilité nulle : série figée, aucune lecture possible');

  const convient = refus.length === 0;

  return {
    moteur: 'synthetique',
    version: '1.0.0',
    famille,
    statistiques: {
      volatilite: vol, ratioVolatilite: ratioVol, zScore: z,
      partSauts: sauts, poidsSauts, autocorrelation1: ac1, rendements: r.length
    },
    regime,
    convient,
    refus,
    faits
  };
}

module.exports = { analyser, famille: s => analyser([], { symbol: s }).famille };
