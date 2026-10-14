/**
 * 5trade — signal scoring par machine learning.
 *
 * Apprend des les trades passés pour optimiser le scoring des signaux.
 * Utilise un modèle de régression logistique simple pour prédire
 * la probabilité de succès d'un signal.
 *
 * Features utilisées :
 *   • Force du signal
 *   • Nombre de règles concordantes
 *   • Tendance du marché
 *   • Position dans le range
 *   • Session active
 *   • ATR relatif
 */

/**
 * Entraîne un modèle de scoring à partir de l'historique des trades.
 *
 * @param {Array} trades - Historique des trades avec résultats
 * @returns {Object} Modèle entraîné { weights: Array, bias: number }
 */
function entrainerModele(trades) {
  if (!trades || trades.length < 10) {
    return { weights: [0.3, 0.2, 0.15, 0.15, 0.1, 0.1], bias: -0.5 };
  }

  // Features : [force, nbRegles, tendance, position, session, atrRel]
  const X = [];
  const y = [];

  for (const t of trades) {
    if (t.status !== 'closed') continue;

    const features = [
      t.signalStrength || 0,
      (t.signalStatus === 'confirme' ? 1 : 0),
      (t.trend === 'bullish' || t.trend === 'bearish') ? 1 : 0,
      (t.position === 'premium' || t.position === 'discount') ? 1 : 0,
      (t.session === 'london' || t.session === 'newyork') ? 1 : 0,
      (t.atrRel || 0.5)
    ];

    X.push(features);
    y.push(t.result === 'win' ? 1 : 0);
  }

  // Régression logistique simple (descente de gradient)
  const weights = [0.3, 0.2, 0.15, 0.15, 0.1, 0.1];
  let bias = -0.5;
  const lr = 0.01;
  const epochs = 100;

  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = 0; i < X.length; i++) {
      const pred = sigmoid(dot(weights, X[i]) + bias);
      const error = pred - y[i];

      for (let j = 0; j < weights.length; j++) {
        weights[j] -= lr * error * X[i][j];
      }
      bias -= lr * error;
    }
  }

  return { weights, bias };
}

/**
 * Prédit la probabilité de succès d'un signal.
 *
 * @param {object} signal - Signal à évaluer
 * @param {object} modele - Modèle entraîné
 * @returns {number} Probabilité de succès (0 à 1)
 */
function predireSucces(signal, modele) {
  if (!modele) return 0.5;

  const features = [
    signal.strength || 0,
    (signal.status === 'confirme' ? 1 : 0),
    (signal.trend === 'bullish' || signal.trend === 'bearish') ? 1 : 0,
    (signal.position === 'premium' || signal.position === 'discount') ? 1 : 0,
    (signal.session === 'london' || signal.session === 'newyork') ? 1 : 0,
    (signal.atrRel || 0.5)
  ];

  return sigmoid(dot(modele.weights, features) + modele.bias);
}

/**
 * Ajuste le seuil de confirmation en fonction du modèle.
 *
 * @param {number} seuilActuel - Seuil actuel (ex: 0.35)
 * @param {number} probaSucces - Probabilité de succès prédite
 * @returns {number} Seuil ajusté
 */
function ajusterSeuil(seuilActuel, probaSucces) {
  // Si la probabilité de succès est élevée, on peut baisser le seuil
  // Si elle est faible, on augmente le seuil
  if (probaSucces > 0.7) return seuilActuel * 0.8;
  if (probaSucces < 0.3) return seuilActuel * 1.2;
  return seuilActuel;
}

/**
 * Évalue la qualité du modèle.
 *
 * @param {object} modele - Modèle entraîné
 * @param {Array} trades - Historique des trades
 * @returns {object} Métriques de performance
 */
function evaluerModele(modele, trades) {
  if (!trades || trades.length < 5) {
    return { accuracy: 0, precision: 0, recall: 0, f1: 0 };
  }

  let tp = 0, fp = 0, tn = 0, fn = 0;

  for (const t of trades) {
    if (t.status !== 'closed') continue;

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
    accuracy: +accuracy.toFixed(3),
    precision: +precision.toFixed(3),
    recall: +recall.toFixed(3),
    f1: +f1.toFixed(3)
  };
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function dot(a, b) {
  return a.reduce((sum, ai, i) => sum + ai * b[i], 0);
}

module.exports = { entrainerModele, predireSucces, ajusterSeuil, evaluerModele };
