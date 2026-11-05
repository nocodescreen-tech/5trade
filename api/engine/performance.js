/**
 * Performance — métriques honnêtes et séparation entraînement / validation.
 *
 * Un backtest qui ne rend que « +12 R » ne dit rien : il faut le profit factor,
 * l'espérance par trade, le drawdown maximal, et surtout la tenue HORS échantillon.
 * Ce module ne calcule que sur des trades réellement tranchés (r numérique), refuse
 * de conclure sur un échantillon trop petit, et n'annonce jamais une probabilité.
 */

/** Trades utilisables : résultat numérique et horodatage. */
function exploitables(trades) {
  return (trades || [])
    .filter(t => t && Number.isFinite(Number(t.r)))
    .map(t => ({ ...t, r: Number(t.r), at: t.at || t.closAt || t.emissionAt || null }))
    .sort((a, b) => (new Date(a.at || 0) - new Date(b.at || 0)));
}

/**
 * @param {Array<{r:number, at?:string}>} trades
 * @returns {{n, gagnants, perdants, neutres, winRate, profitFactor, expectancyR,
 *            gainMoyen, perteMoyenne, maxDrawdownR, rTotal}}
 */
function metriques(trades) {
  const t = exploitables(trades);
  const n = t.length;
  if (!n) {
    return { n: 0, gagnants: 0, perdants: 0, neutres: 0, winRate: null, profitFactor: null,
      expectancyR: null, gainMoyen: null, perteMoyenne: null, maxDrawdownR: 0, rTotal: 0 };
  }

  let gains = 0, pertes = 0, gagnants = 0, perdants = 0, neutres = 0, rTotal = 0;
  for (const x of t) {
    rTotal += x.r;
    if (x.r > 0) { gains += x.r; gagnants++; }
    else if (x.r < 0) { pertes += Math.abs(x.r); perdants++; }
    else neutres++;
  }

  // Drawdown en R : écart maximal sous le plus haut cumulé.
  let cumul = 0, sommet = 0, maxDD = 0;
  for (const x of t) {
    cumul += x.r;
    if (cumul > sommet) sommet = cumul;
    const dd = sommet - cumul;
    if (dd > maxDD) maxDD = dd;
  }

  const tranches = gagnants + perdants;
  return {
    n,
    gagnants, perdants, neutres,
    winRate: tranches ? Math.round((gagnants / tranches) * 1000) / 10 : null,
    // Profit factor : gains bruts / pertes brutes. Infini si aucune perte — on le
    // dit au lieu de renvoyer un nombre trompeur.
    profitFactor: pertes > 0 ? Math.round((gains / pertes) * 100) / 100
      : (gains > 0 ? 'infini' : null),
    expectancyR: Math.round((rTotal / n) * 1000) / 1000,
    gainMoyen: gagnants ? Math.round((gains / gagnants) * 1000) / 1000 : null,
    perteMoyenne: perdants ? Math.round((pertes / perdants) * 1000) / 1000 : null,
    maxDrawdownR: Math.round(maxDD * 100) / 100,
    rTotal: Math.round(rTotal * 100) / 100
  };
}

/**
 * Découpe chronologique : les N premiers trades entraînent, les derniers valident.
 * Jamais de mélange — sinon la validation voit le futur de l'entraînement.
 * @param {Array} trades
 * @param {{fractionValidation?:number, minimumEntrainement?:number}} [options]
 */
function decouper(trades, options = {}) {
  const t = exploitables(trades);
  const fraction = Number.isFinite(options.fractionValidation) ? options.fractionValidation : 0.3;
  const mini = Number.isFinite(options.minimumEntrainement) ? options.minimumEntrainement : 20;
  const coupe = Math.floor(t.length * (1 - fraction));
  if (t.length < mini + 10) {
    return { entrainement: t, validation: [], motif: `seulement ${t.length} trade(s) : pas de découpe honnête possible` };
  }
  return {
    entrainement: t.slice(0, coupe),
    validation: t.slice(coupe),
    coupe: t[coupe] ? t[coupe].at : null
  };
}

/**
 * Verdict de fiabilité. Ne dit jamais « rentable » : dit si la performance se
 * reproduit hors échantillon et sur un échantillon suffisant.
 */
function verdict(trades, options = {}) {
  const miniValidation = Number.isFinite(options.minimumValidation) ? options.minimumValidation : 30;
  const { entrainement, validation, motif } = decouper(trades, options);
  const mIS = metriques(entrainement);
  const mOOS = metriques(validation);
  const raisons = [];
  if (motif) raisons.push(motif);
  if (!mIS.n) raisons.push('aucun trade tranché');
  if (mOOS.n && mOOS.n < miniValidation) {
    raisons.push(`validation de ${mOOS.n} trade(s) : sous le minimum de ${miniValidation}, rien n'est démontré`);
  }
  if (!mOOS.n && mIS.n) raisons.push('aucune validation hors échantillon : performance non confirmée');
  if (mOOS.n >= miniValidation && mOOS.expectancyR <= 0) {
    raisons.push(`espérance hors échantillon ${mOOS.expectancyR} R : la performance ne se reproduit pas`);
  }
  const fiable = raisons.length === 0 && mIS.n >= 20 && mOOS.n >= miniValidation && mOOS.expectancyR > 0;
  return { fiable, raisons, entrainement: mIS, validation: mOOS };
}

/**
 * Groupes par dimension (stratégie, symbole, unité de temps).
 * Un groupe sous 10 trades est marqué « trop faible », pas masqué.
 */
function parDimension(trades, cle, options = {}) {
  const mini = Number.isFinite(options.minimum) ? options.minimum : 10;
  const groupes = new Map();
  for (const t of exploitables(trades)) {
    const k = t[cle] === undefined || t[cle] === null || t[cle] === '' ? 'inconnu' : String(t[cle]);
    if (!groupes.has(k)) groupes.set(k, []);
    groupes.get(k).push(t);
  }
  return [...groupes.entries()]
    .map(([valeur, liste]) => ({ [cle]: valeur, ...metriques(liste), fiable: liste.length >= mini }))
    .sort((a, b) => b.rTotal - a.rTotal);
}

/**
 * Contrôle anti look-ahead minimal et vérifiable : un trade ne peut pas être
 * évalué avant d'exister, ni clos avant d'être ouvert.
 */
function verifierChronologie(trades) {
  const anomalies = [];
  for (const t of (trades || [])) {
    const ouverture = t.at ? new Date(t.at).getTime() : null;
    const cloture = t.closAt ? new Date(t.closAt).getTime() : null;
    if (ouverture && cloture && cloture < ouverture) {
      anomalies.push({ id: t.id || null, raison: 'clôture antérieure à l\'ouverture' });
    }
  }
  return { ok: anomalies.length === 0, anomalies };
}

module.exports = { metriques, decouper, verdict, parDimension, verifierChronologie, exploitables };
