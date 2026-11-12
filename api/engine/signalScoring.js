/**
 * 5trade — scoring des signaux par régression logistique.
 *
 * Trois défauts corrigés ici, tous mesurables :
 *
 *  1. **Poids de secours présentés comme un modèle.** Avec moins de 10 trades,
 *     la fonction rendait des poids fixes sans le dire : l'écran affichait
 *     « Score ML » avec des métriques, comme si un modèle avait appris quelque
 *     chose. Ces poids sont un point de départ, jamais un apprentissage.
 *  2. **Évaluation sur les données d'entraînement.** `evaluerModele(modele,
 *     trades)` était appelée avec le MÊME jeu que `entrainerModele` : l'accuracy
 *     mesurait la capacité du modèle à se réciter, pas à prédire. Un modèle à
 *     6 paramètres sur 10 trades atteint facilement 90 % en interne et 50 % en
 *     réel. D'où `evaluerHorsEchantillon()`, qui sépare par ORDRE CHRONOLOGIQUE.
 *  3. **Trop peu de données pour 6 paramètres.** Le minimum passe à 5 trades par
 *     paramètre (30), et un jeu sans les deux issues (que des gains ou que des
 *     pertes) est refusé : on ne peut pas apprendre à distinguer ce qui est
 *     toujours pareil.
 */

const FEATURES = 6;                 // [force, confirmé, tendance, zone, session, atrRel]
const PAR_TRADE = 5;                // observations minimales par paramètre
const MIN_ENTRAINEMENT = FEATURES * PAR_TRADE;
const POIDS_DEPART = [0.3, 0.2, 0.15, 0.15, 0.1, 0.1];

const fermes = trades => (trades || []).filter(t => t && t.status === 'closed');
const dateTrade = t => new Date(t.closedAt || t.createdAt || 0).getTime() || 0;

/** Découpe CHRONOLOGIQUE : le passé pour apprendre, le futur pour mesurer. */
function decouper(trades, ratio = 0.7) {
  const tri = fermes(trades).slice().sort((a, b) => dateTrade(a) - dateTrade(b));
  if (tri.length < 10) return { apprentissage: tri, test: [] };
  const coupe = Math.floor(tri.length * ratio);
  return { apprentissage: tri.slice(0, coupe), test: tri.slice(coupe) };
}

function vecteur(t) {
  return [
    Number(t.signalStrength) || 0,
    t.signalStatus === 'confirme' ? 1 : 0,
    (t.trend === 'bullish' || t.trend === 'bearish') ? 1 : 0,
    (t.position === 'premium' || t.position === 'discount') ? 1 : 0,
    (t.session === 'london' || t.session === 'newyork') ? 1 : 0,
    Number.isFinite(t.atrRel) ? t.atrRel : 0.5
  ];
}

/**
 * Entraîne un modèle de scoring.
 * @returns {{weights:number[], bias:number, entraine:boolean, echantillon:number,
 *            minimumRequis:number, avertissement?:string}}
 */
function entrainerModele(trades) {
  const lot = fermes(trades);
  const echantillon = lot.length;

  const refus = raison => ({
    weights: POIDS_DEPART.slice(), bias: -0.5,
    entraine: false, echantillon, minimumRequis: MIN_ENTRAINEMENT,
    avertissement: raison
  });

  if (echantillon < MIN_ENTRAINEMENT) {
    return refus(`modèle NON entraîné : ${echantillon} trade(s) clôturé(s), `
      + `${MIN_ENTRAINEMENT} requis (${PAR_TRADE} par paramètre × ${FEATURES}). `
      + 'Les poids affichés sont un point de départ, pas un apprentissage.');
  }

  const X = lot.map(vecteur);
  const y = lot.map(t => (t.result === 'win' ? 1 : 0));
  const gains = y.reduce((a, b) => a + b, 0);
  if (gains === 0 || gains === y.length) {
    return refus(`modèle NON entraîné : les ${echantillon} trades sont tous `
      + `${gains === 0 ? 'perdants' : 'gagnants'}. Sans les deux issues, il n'y a rien à distinguer.`);
  }

  // Régression logistique (descente de gradient), mêmes hyperparamètres qu'avant.
  const weights = POIDS_DEPART.slice();
  let bias = -0.5;
  const lr = 0.01;
  const epochs = 100;
  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = 0; i < X.length; i++) {
      const pred = sigmoid(dot(weights, X[i]) + bias);
      const error = pred - y[i];
      for (let j = 0; j < weights.length; j++) weights[j] -= lr * error * X[i][j];
      bias -= lr * error;
    }
  }
  return { weights, bias, entraine: true, echantillon, minimumRequis: MIN_ENTRAINEMENT };
}

/** Probabilité de succès prédite (0 à 1). */
function predireSucces(signal, modele) {
  if (!modele || !Array.isArray(modele.weights)) return 0.5;
  return sigmoid(dot(modele.weights, vecteur(signal)) + (modele.bias || 0));
}

/** Ajuste un seuil de décision autour de 0,5 selon la probabilité prédite. */
function ajusterSeuil(seuilActuel, probaSucces) {
  const s = Number.isFinite(seuilActuel) ? seuilActuel : 0.5;
  const p = Number.isFinite(probaSucces) ? probaSucces : 0.5;
  return +(s + (p - 0.5) * 0.2).toFixed(3);
}

/**
 * Métriques sur un jeu donné. `type` dit SUR QUOI on mesure :
 * « interne » = données d'entraînement (optimiste par construction),
 * « hors-échantillon » = données jamais vues.
 */
function evaluerModele(modele, trades, { type = 'interne' } = {}) {
  const lot = fermes(trades);
  if (lot.length < 5) {
    return { accuracy: 0, precision: 0, recall: 0, f1: 0, echantillon: lot.length, type, valide: false,
      raison: `moins de 5 trades clôturés (${lot.length}) : aucune métrique honnête possible` };
  }

  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const t of lot) {
    const pred = predireSucces(t, modele);
    const actual = t.result === 'win';
    if (pred > 0.5 && actual) tp++;
    else if (pred > 0.5 && !actual) fp++;
    else if (pred <= 0.5 && !actual) tn++;
    else fn++;
  }
  const accuracy = (tp + tn) / (tp + tn + fp + fn) || 0;
  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1 = 2 * (precision * recall) / (precision + recall) || 0;

  return {
    accuracy: +accuracy.toFixed(3), precision: +precision.toFixed(3),
    recall: +recall.toFixed(3), f1: +f1.toFixed(3),
    echantillon: lot.length, type, valide: true
  };
}

/**
 * La seule mesure qui vaut quelque chose : entraîner sur le passé, mesurer sur
 * la suite. Rend `valide: false` — et la raison — quand ce n'est pas possible.
 */
function evaluerHorsEchantillon(trades, ratio = 0.7) {
  const { apprentissage, test } = decouper(trades, ratio);
  if (apprentissage.length < MIN_ENTRAINEMENT) {
    return { valide: false, apprentissage: apprentissage.length, test: test.length,
      raison: `${apprentissage.length} trade(s) d'apprentissage, ${MIN_ENTRAINEMENT} requis` };
  }
  if (test.length < 5) {
    return { valide: false, apprentissage: apprentissage.length, test: test.length,
      raison: `${test.length} trade(s) de test, 5 requis pour une mesure` };
  }
  const modele = entrainerModele(apprentissage);
  if (!modele.entraine) {
    return { valide: false, apprentissage: apprentissage.length, test: test.length,
      raison: modele.avertissement };
  }
  return {
    valide: true,
    apprentissage: apprentissage.length,
    test: test.length,
    modele,
    metrics: evaluerModele(modele, test, { type: 'hors-echantillon' })
  };
}

/** Ce score pondère-t-il réellement une décision ? Aujourd'hui : non. */
const APPLIQUE_AUX_DECISIONS = false;

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * (b[i] || 0);
  return s;
}

module.exports = {
  entrainerModele, predireSucces, ajusterSeuil, evaluerModele,
  evaluerHorsEchantillon, decouper, MIN_ENTRAINEMENT, FEATURES, APPLIQUE_AUX_DECISIONS
};
