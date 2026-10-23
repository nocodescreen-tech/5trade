/**
 * VALIDITÉ STATISTIQUE D'UN AVANTAGE.
 *
 * Le système savait mesurer une espérance en R. Il ne savait pas dire si elle
 * existe. Trois chiffres manquaient, tous définis par Bailey & López de Prado :
 *
 *   PSR   Probabilistic Sharpe Ratio — probabilité que le Sharpe réel dépasse un
 *         seuil, en tenant compte de la taille d'échantillon, de l'asymétrie et
 *         de l'aplatissement (un Sharpe calculé sur une distribution à queue
 *         épaisse est moins significatif qu'il n'y paraît).
 *   DSR   Deflated Sharpe Ratio — le même, mais le seuil est relevé par le nombre
 *         d'essais : chercher le meilleur de N configurations garantit un bon
 *         Sharpe même sans compétence. DSR > 0,95 = l'avantage survit à la
 *         recherche.
 *   MinBTL Longueur minimale de backtest — combien d'observations faut-il pour
 *         que le Sharpe observé ne soit pas un artefact du nombre d'essais.
 *   PBO   Probability of Backtest Overfitting — par validation croisée combinée
 *         (CSCV) : à quelle fréquence la meilleure configuration en apprentissage
 *         passe-t-elle sous la médiane hors échantillon.
 *
 * Aucune de ces formules ne dépend du marché ni du moteur : elles jugent un
 * résultat, pas une méthode.
 */

const EULER = 0.5772156649015329;

/** Fonction de répartition de la loi normale centrée réduite. */
function phi(x) {
  // Approximation d'Abramowitz & Stegun 7.1.26 sur erf, précision ~1e-7.
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937
    + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Inverse de la fonction de répartition (Acklam, précision ~1e-9). */
function invPhi(p) {
  if (!(p > 0 && p < 1)) throw new Error(`invPhi hors domaine : ${p}`);
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00];
  const pB = 0.02425;
  let q, r;
  if (p < pB) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pB) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Moyenne, écart-type, asymétrie, aplatissement (non excédentaire). */
function moments(xs) {
  const n = xs.length;
  if (!n) return { n: 0, moyenne: 0, ecart: 0, asymetrie: 0, aplatissement: 3 };
  const moyenne = xs.reduce((a, x) => a + x, 0) / n;
  if (n < 2) return { n, moyenne, ecart: 0, asymetrie: 0, aplatissement: 3 };
  const m2 = xs.reduce((a, x) => a + (x - moyenne) ** 2, 0) / n;
  const ecart = Math.sqrt(m2);
  if (!(m2 > 0)) return { n, moyenne, ecart: 0, asymetrie: 0, aplatissement: 3 };
  const m3 = xs.reduce((a, x) => a + (x - moyenne) ** 3, 0) / n;
  const m4 = xs.reduce((a, x) => a + (x - moyenne) ** 4, 0) / n;
  return { n, moyenne, ecart, asymetrie: m3 / m2 ** 1.5, aplatissement: m4 / m2 ** 2 };
}

/** Sharpe par observation (par trade ici, pas annualisé). */
function sharpe(rendements) {
  const m = moments(rendements);
  return m.ecart > 0 ? m.moyenne / m.ecart : 0;
}

/**
 * Probabilistic Sharpe Ratio : P(Sharpe réel > seuil).
 * Formule de Bailey & López de Prado (2012), qui corrige l'effet de la taille
 * d'échantillon et de la non-normalité.
 */
function psr(rendements, seuil = 0) {
  const m = moments(rendements);
  if (m.n < 3 || !(m.ecart > 0)) return null;
  const sr = m.moyenne / m.ecart;
  const variance = 1 - m.asymetrie * sr + ((m.aplatissement - 1) / 4) * sr * sr;
  if (!(variance > 0)) return null;
  return phi(((sr - seuil) * Math.sqrt(m.n - 1)) / Math.sqrt(variance));
}

/**
 * Seuil de Sharpe attendu par le seul fait d'essayer N configurations au hasard.
 * C'est ce qui « déflate » le résultat.
 */
function seuilDeSelection(nEssais) {
  const n = Math.max(2, Math.round(nEssais));
  return (1 - EULER) * invPhi(1 - 1 / n) + EULER * invPhi(1 - 1 / (n * Math.E));
}

/** Deflated Sharpe Ratio : PSR évalué contre le seuil de sélection. */
function dsr(rendements, nEssais = 1, varianceSharpe = 1) {
  const m = moments(rendements);
  if (m.n < 3 || !(m.ecart > 0)) return null;
  const sr = m.moyenne / m.ecart;
  const sr0 = Math.sqrt(Math.max(varianceSharpe, 1e-12)) * seuilDeSelection(nEssais);
  const p = psr(rendements, sr0);
  return p === null ? null : { psr: p, seuil: sr0, sharpe: sr };
}

/**
 * Nombre d'observations en dessous duquel un Sharpe observé ne peut pas être
 * distingué de la meilleure des N configurations tirées au hasard.
 */
function longueurMinimale(sharpeObserve, nEssais = 1) {
  if (!(Math.abs(sharpeObserve) > 1e-9)) return Infinity;
  return (seuilDeSelection(nEssais) / sharpeObserve) ** 2 + 1;
}

/**
 * PBO par CSCV (Bailey, Borwein, López de Prado, Zhu).
 * `matrice` : lignes = périodes, colonnes = configurations, valeurs = rendement.
 * On coupe en S blocs, on essaie toutes les façons d'en prendre la moitié comme
 * apprentissage, on regarde le rang hors échantillon de la meilleure en
 * apprentissage, et on compte la fréquence à laquelle elle finit sous la médiane.
 */
function pbo(matrice, { blocs = 10 } = {}) {
  const T = matrice.length;
  const N = T ? matrice[0].length : 0;
  if (T < blocs * 2 || N < 2) return null;
  const S = blocs % 2 ? blocs - 1 : blocs;            // doit être pair
  const taille = Math.floor(T / S);
  const blocsIdx = Array.from({ length: S }, (_, i) =>
    Array.from({ length: taille }, (_, j) => i * taille + j));

  // Toutes les combinaisons de S/2 blocs.
  const combinaisons = [];
  const moitie = S / 2;
  const choisir = (debut, choisis) => {
    if (choisis.length === moitie) { combinaisons.push([...choisis]); return; }
    for (let i = debut; i < S; i++) { choisis.push(i); choisir(i + 1, choisis); choisis.pop(); }
  };
  choisir(0, []);

  const srColonne = (lignes) => {
    const out = new Array(N).fill(0);
    for (let c = 0; c < N; c++) {
      const serie = lignes.map(i => matrice[i][c]);
      out[c] = sharpe(serie);
    }
    return out;
  };

  let sousMediane = 0;
  let essayees = 0;
  for (const dans of combinaisons) {
    const dehors = [...Array(S).keys()].filter(i => !dans.includes(i));
    const idxIn = dans.flatMap(i => blocsIdx[i]);
    const idxOut = dehors.flatMap(i => blocsIdx[i]);
    const srIn = srColonne(idxIn);
    const srOut = srColonne(idxOut);
    let meilleure = 0;
    for (let c = 1; c < N; c++) if (srIn[c] > srIn[meilleure]) meilleure = c;
    // Rang de la meilleure configuration dans la distribution hors échantillon.
    const rang = srOut.filter(v => v < srOut[meilleure]).length / Math.max(1, N - 1);
    if (rang <= 0.5) sousMediane++;
    essayees++;
  }
  return { pbo: sousMediane / essayees, combinaisons: essayees, blocs: S, T: taille * S, N };
}

/** Table lisible : une ligne par configuration. */
function tableau(configurations, { nEssais } = {}) {
  const essais = nEssais || configurations.length;
  const sharpeMoyen = configurations.map(c => sharpe(c.rendements));
  const variance = moments(sharpeMoyen).ecart ** 2;

  return configurations.map(c => {
    const d = dsr(c.rendements, essais, variance || 1);
    const sr = sharpe(c.rendements);
    return {
      nom: c.nom,
      n: c.rendements.length,
      totalR: +c.rendements.reduce((a, x) => a + x, 0).toFixed(2),
      esperance: +(moments(c.rendements).moyenne || 0).toFixed(4),
      sharpe: +sr.toFixed(4),
      psr: d ? +d.psr.toFixed(3) : null,
      seuilSelection: d ? +d.seuil.toFixed(3) : null,
      longueurMinimale: Math.round(longueurMinimale(sr, essais)),
      survit: d ? d.psr > 0.95 : false
    };
  }).sort((a, b) => b.esperance - a.esperance);
}

module.exports = { phi, invPhi, moments, sharpe, psr, dsr, pbo, longueurMinimale,
  seuilDeSelection, tableau };
