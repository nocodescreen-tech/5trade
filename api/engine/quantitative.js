/**
 * Quantitative Engine — ratios, Monte Carlo, robustesse.
 *
 * Ces calculs ne prédisent rien : ils mesurent la FORME d'une série de résultats.
 * Un Sharpe élevé sur 12 trades ne vaut rien, et un Monte Carlo ne dit pas ce qui
 * va arriver — il dit à quelle vitesse la même séquence, mélangée, peut faire mal.
 *
 * Convention assumée : tous les ratios sont exprimés PAR TRADE, en R. Les
 * annualiser supposerait un nombre de trades par an que nous ne connaissons pas.
 */

const { metriques } = require('./performance');

/** Générateur pseudo-aléatoire reproductible (LCG) : même graine, même résultat. */
function aleatoire(graine = 42) {
  let s = graine >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const serie = trades => (trades || [])
  .filter(t => t && Number.isFinite(Number(t.r)))
  .map(t => Number(t.r));

/**
 * @param {Array} trades
 * @returns {{sharpe, sortino, calmar, recoveryFactor, pertesConsecutives, note}}
 */
function ratios(trades) {
  const r = serie(trades);
  const n = r.length;
  if (n < 2) {
    return { sharpe: null, sortino: null, calmar: null, recoveryFactor: null,
      pertesConsecutives: 0, note: 'moins de deux trades : aucun ratio n\'a de sens' };
  }

  const moyenne = r.reduce((a, v) => a + v, 0) / n;
  const ecart = Math.sqrt(r.reduce((a, v) => a + (v - moyenne) ** 2, 0) / (n - 1));
  const baisse = r.filter(v => v < 0);
  const ecartBaisse = baisse.length
    ? Math.sqrt(baisse.reduce((a, v) => a + v * v, 0) / baisse.length)
    : 0;

  // metriques() attend des objets { r } : on emballe, sinon n vaut 0 et le
  // drawdown revient à zéro — ce qui rendait calmar et recovery silencieusement nuls.
  const m = metriques(r.map(v => ({ r: v })));
  const dd = m.maxDrawdownR;

  // Pertes consécutives : la série qui use le moral avant d'user le capital.
  let pire = 0, courant = 0;
  for (const v of r) {
    if (v < 0) { courant++; if (courant > pire) pire = courant; }
    else courant = 0;
  }

  return {
    sharpe: ecart > 0 ? Math.round((moyenne / ecart) * 1000) / 1000 : null,
    sortino: ecartBaisse > 0 ? Math.round((moyenne / ecartBaisse) * 1000) / 1000 : null,
    calmar: dd > 0 ? Math.round((m.rTotal / dd) * 100) / 100 : null,
    recoveryFactor: dd > 0 ? Math.round((m.rTotal / dd) * 100) / 100 : null,
    pertesConsecutives: pire,
    note: n < 30 ? `seulement ${n} trade(s) : ratios indicatifs, pas démonstratifs` : ''
  };
}

/**
 * Monte Carlo par rééchantillonnage de l'ORDRE (permutation) : la performance
 * totale est identique, seule la séquence change. Ce qui varie, c'est le
 * drawdown — donc la douleur réelle, et le risque d'abandonner avant la fin.
 *
 * @param {Array} trades
 * @param {{iterations?:number, graine?:number, seuilDouleur?:number}} [options]
 */
function monteCarlo(trades, options = {}) {
  const r = serie(trades);
  const iterations = Number.isFinite(options.iterations) ? Math.max(100, Math.min(20000, options.iterations)) : 2000;
  if (r.length < 10) {
    return { ok: false, raison: `${r.length} trade(s) : un Monte Carlo en dessous de 10 ne dit rien` };
  }

  const total = r.reduce((a, v) => a + v, 0);
  const maxDDreel = (() => {
    let cumul = 0, sommet = 0, dd = 0;
    for (const v of r) { cumul += v; if (cumul > sommet) sommet = cumul; if (sommet - cumul > dd) dd = sommet - cumul; }
    return dd;
  })();

  const tirer = aleatoire(options.graine);
  const dds = [];
  for (let i = 0; i < iterations; i++) {
    // Mélange de Fisher-Yates sur une copie : aucune valeur inventée.
    const copie = r.slice();
    for (let j = copie.length - 1; j > 0; j--) {
      const k = Math.floor(tirer() * (j + 1));
      [copie[j], copie[k]] = [copie[k], copie[j]];
    }
    let cumul = 0, sommet = 0, dd = 0;
    for (const v of copie) {
      cumul += v;
      if (cumul > sommet) sommet = cumul;
      if (sommet - cumul > dd) dd = sommet - cumul;
    }
    dds.push(dd);
  }
  dds.sort((a, b) => a - b);
  const centile = p => Math.round(dds[Math.min(dds.length - 1, Math.floor(p * dds.length))] * 100) / 100;

  const seuil = Number.isFinite(options.seuilDouleur) ? options.seuilDouleur : Math.max(maxDDreel, 1);
  const auDela = dds.filter(d => d > seuil * 2).length;

  return {
    ok: true, iterations, trades: r.length,
    total: Math.round(total * 100) / 100,
    drawdownReel: Math.round(maxDDreel * 100) / 100,
    drawdownMedian: centile(0.5),
    drawdown95: centile(0.95),
    drawdownPire: centile(0.999),
    pireSequentiel: Math.round(dds[dds.length - 1] * 100) / 100,
    risqueDoubleDouleur: Math.round((auDela / iterations) * 1000) / 10,
    lecture: 'La performance totale ne change pas : seule la séquence change. ' +
      'Ce qui varie, c\'est la douleur traversée — donc la capacité à tenir.'
  };
}

/**
 * Marche avant (walk-forward) : découpe en N blocs chronologiques et vérifie que
 * l'espérance reste du même signe. Une stratégie qui ne gagne que sur un bloc est
 * une coïncidence.
 */
function marcheAvant(trades, options = {}) {
  const r = serie(trades);
  const blocs = Number.isFinite(options.blocs) ? Math.max(2, Math.min(10, options.blocs)) : 4;
  if (r.length < blocs * 10) {
    return { ok: false, raison: `${r.length} trade(s) pour ${blocs} blocs : chaque bloc serait trop mince` };
  }
  const taille = Math.floor(r.length / blocs);
  const resultats = [];
  for (let i = 0; i < blocs; i++) {
    const debut = i * taille;
    const fin = i === blocs - 1 ? r.length : (i + 1) * taille;
    const m = metriques(r.slice(debut, fin).map(v => ({ r: v })));
    resultats.push({ bloc: i + 1, n: m.n, esperance: m.expectancyR, pf: m.profitFactor, rTotal: m.rTotal });
  }
  const positifs = resultats.filter(b => b.esperance > 0).length;
  return {
    ok: true, blocs: resultats, positifs,
    stable: positifs === blocs,
    lecture: `${positifs}/${blocs} bloc(s) à espérance positive`
  };
}

module.exports = { ratios, monteCarlo, marcheAvant, aleatoire };
