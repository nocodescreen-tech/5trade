/**
 * Data Quality Engine — la première ligne de défense.
 *
 * Tout ce qui suit (régime, stratégie, signal, risque) hérite des données. Une
 * bougie manquante, un doublon, un prix aberrant ou un flux figé produisent des
 * décisions fausses avec une apparence de rigueur.
 *
 * Ce module ne corrige RIEN : il mesure et il nomme. À l'appelant de refuser.
 */

/** Intervalles attendus, en millisecondes. */
const TF_MS = {
  '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000,
  '1h': 3600000, '4h': 14400000, '1d': 86400000
};

const GRAVITE = { critique: 'critique', avertissement: 'avertissement' };

const nombre = v => Number.isFinite(Number(v));

/**
 * @param {Array<{t,o,h,l,c,v,closed}>} bougies
 * @param {object} [options] { timeframe, maintenant, toleranceRetard=3, maxTrousPct=5,
 *                            rangeAberrant=8 }
 * @returns {{ok:boolean, score:number, problemes:Array, critiques:number, mesures:object}}
 */
function analyser(bougies, options = {}) {
  const tf = options.timeframe || null;
  const intervalle = TF_MS[tf] || null;
  const maintenant = options.maintenant || Date.now();
  const tolerance = Number.isFinite(options.toleranceRetard) ? options.toleranceRetard : 3;
  const maxTrousPct = Number.isFinite(options.maxTrousPct) ? options.maxTrousPct : 5;
  const rangeAberrant = Number.isFinite(options.rangeAberrant) ? options.rangeAberrant : 8;

  const problemes = [];
  const ajouter = (type, detail, gravite = GRAVITE.avertissement) =>
    problemes.push({ type, detail, gravite });

  const liste = (bougies || []).filter(b => b && typeof b === 'object');
  const mesures = { bougies: liste.length, timeframe: tf, intervalle, trous: 0, anomalies: 0 };

  if (!liste.length) {
    ajouter('vide', 'aucune bougie reçue', GRAVITE.critique);
    return { ok: false, score: 0, problemes, critiques: 1, mesures };
  }

  // 1. Champs numériques utilisables.
  const invalides = liste.filter(b => !nombre(b.o) || !nombre(b.h) || !nombre(b.l) || !nombre(b.c));
  if (invalides.length) {
    ajouter('valeurs', `${invalides.length} bougie(s) avec un prix non numérique`,
      invalides.length > liste.length * 0.1 ? GRAVITE.critique : GRAVITE.avertissement);
  }

  // 2. Cohérence interne : high ≥ low, clôture et ouverture dans l'amplitude.
  // Haut < bas n'est pas une imprécision : c'est une donnée impossible. Une seule
  // suffit à invalider la série. Un prix hors amplitude reste une anomalie
  // proportionnelle (les fournisseurs arrondissent parfois).
  let impossibles = 0, horsAmplitude = 0;
  for (const b of liste) {
    if (!nombre(b.h) || !nombre(b.l) || !nombre(b.o) || !nombre(b.c)) continue;
    if (b.h < b.l) impossibles++;
    else if (b.c > b.h + 1e-12 || b.c < b.l - 1e-12) horsAmplitude++;
    else if (b.o > b.h + 1e-12 || b.o < b.l - 1e-12) horsAmplitude++;
  }
  if (impossibles) {
    mesures.anomalies += impossibles;
    ajouter('incoherence', `${impossibles} bougie(s) avec un haut inférieur au bas`, GRAVITE.critique);
  }
  if (horsAmplitude) {
    mesures.anomalies += horsAmplitude;
    ajouter('amplitude-prix', `${horsAmplitude} bougie(s) dont un prix sort de l'amplitude`,
      horsAmplitude > liste.length * 0.05 ? GRAVITE.critique : GRAVITE.avertissement);
  }

  // 3. Horodatages : présents, croissants, sans doublon.
  const horodatees = liste.filter(b => nombre(b.t));
  if (horodatees.length !== liste.length) {
    ajouter('horodatage', `${liste.length - horodatees.length} bougie(s) sans horodatage exploitable`,
      GRAVITE.critique);
  }
  if (horodatees.length > 1) {
    let desordre = 0, doublons = 0;
    for (let i = 1; i < horodatees.length; i++) {
      const dt = Number(horodatees[i].t) - Number(horodatees[i - 1].t);
      if (dt < 0) desordre++;
      else if (dt === 0) doublons++;
    }
    if (desordre) ajouter('ordre', `${desordre} rupture(s) d'ordre chronologique`, GRAVITE.critique);
    if (doublons) ajouter('doublon', `${doublons} horodatage(s) en double`, GRAVITE.avertissement);
  }

  // 4. Trous : intervalles plus grands que l'unité de temps attendue.
  if (intervalle && horodatees.length > 1) {
    let trous = 0, plusGrand = 0, manquantes = 0;
    for (let i = 1; i < horodatees.length; i++) {
      const dt = Number(horodatees[i].t) - Number(horodatees[i - 1].t);
      if (dt > intervalle * 1.5) {
        trous++;
        // Bougies réellement absentes, pas seulement « un intervalle plus long ».
        manquantes += Math.round(dt / intervalle) - 1;
        if (dt > plusGrand) plusGrand = dt;
      }
    }
    mesures.trous = trous;
    mesures.manquantes = manquantes;
    const pct = Math.round((manquantes / (horodatees.length + manquantes)) * 1000) / 10;
    if (trous) {
      ajouter('trous', `${trous} trou(s) dans l'historique (${pct} % des bougies, plus grand : ${Math.round(plusGrand / 60000)} min)`,
        pct > maxTrousPct ? GRAVITE.critique : GRAVITE.avertissement);
    }
  } else if (!intervalle && options.timeframe) {
    ajouter('timeframe', `unité de temps inconnue « ${options.timeframe} » : les trous ne peuvent pas être mesurés`,
      GRAVITE.avertissement);
  }

  // 5. Fraîcheur : la dernière bougie doit être récente — SAUF pour un historique
  //    stocké, où une série qui s'arrête est normale : on mesure alors sa
  //    couverture, pas sa fraîcheur.
  const derniere = horodatees[horodatees.length - 1];
  if (derniere && intervalle && !options.historique) {
    const age = maintenant - Number(derniere.t);
    mesures.ageMin = Math.round(age / 60000);
    if (age > intervalle * tolerance) {
      ajouter('peremption', `dernière bougie vieille de ${mesures.ageMin} min (limite ${Math.round(intervalle * tolerance / 60000)} min)`,
        GRAVITE.critique);
    }
  }

  // 6. Bougies aberrantes : amplitude démesurée par rapport à la médiane.
  const amplitudes = liste.filter(b => nombre(b.h) && nombre(b.l)).map(b => Number(b.h) - Number(b.l)).sort((a, b) => a - b);
  if (amplitudes.length >= 10) {
    const mediane = amplitudes[Math.floor(amplitudes.length / 2)];
    if (mediane > 0) {
      const aberrantes = amplitudes.filter(a => a > mediane * rangeAberrant).length;
      if (aberrantes) {
        mesures.anomalies += aberrantes;
        ajouter('amplitude', `${aberrantes} bougie(s) d'amplitude > ${rangeAberrant}× la médiane`,
          aberrantes > amplitudes.length * 0.05 ? GRAVITE.critique : GRAVITE.avertissement);
      }
    }
  }

  // 7. Volume : négatif impossible ; nul partout = fournisseur sans volume.
  if (liste.some(b => nombre(b.v) && Number(b.v) < 0)) {
    ajouter('volume', 'volume négatif détecté', GRAVITE.critique);
  } else if (liste.every(b => nombre(b.v) && Number(b.v) === 0)) {
    ajouter('volume', 'volume à zéro sur toute la série : fournisseur sans volume', GRAVITE.avertissement);
  }

  const critiques = problemes.filter(p => p.gravite === GRAVITE.critique).length;
  const avertissements = problemes.length - critiques;
  // Score : 1 moins la pénalité (un critique bloque, un avertissement entame).
  const score = Math.max(0, Math.min(1,
    1 - Math.min(0.6, critiques * 0.6) - Math.min(0.35, avertissements * 0.08)));

  return {
    ok: critiques === 0,
    score: Math.round(score * 100) / 100,
    critiques,
    avertissements,
    problemes,
    mesures
  };
}

/**
 * Synchronisation temporelle de plusieurs unités de temps : les dernières bougies
 * clôturées doivent décrire le même présent. Un H1 en retard de 3 h sur un M5 ne
 * confirme rien.
 *
 * @param {Array<{timeframe, bougies}>} series
 * @returns {{aligne:boolean, ecarts:Array, raison:string}}
 */
function synchroniser(series, options = {}) {
  const maintenant = options.maintenant || Date.now();
  const ecarts = [];
  const dernieres = [];
  for (const s of (series || [])) {
    const derniere = (s.bougies || []).filter(b => b && b.closed !== false && nombre(b.t)).pop();
    if (!derniere) {
      ecarts.push({ timeframe: s.timeframe, raison: 'aucune bougie clôturée' });
      continue;
    }
    dernieres.push({ timeframe: s.timeframe, t: Number(derniere.t), intervalle: TF_MS[s.timeframe] || null });
  }
  if (dernieres.length < 2) {
    return { aligne: false, ecarts: ecarts.length ? ecarts : [{ raison: 'moins de deux séries' }],
      raison: 'synchronisation invérifiable : moins de deux unités de temps exploitables' };
  }
  const plusRecente = Math.max(...dernieres.map(d => d.t));
  for (const d of dernieres) {
    if (!d.intervalle) {
      ecarts.push({ timeframe: d.timeframe, raison: 'unité inconnue' });
      continue;
    }
    const retard = plusRecente - d.t;
    if (retard > d.intervalle * 1.5) {
      ecarts.push({ timeframe: d.timeframe,
        raison: `en retard de ${Math.round(retard / 60000)} min sur la série la plus récente` });
    }
    if (maintenant - d.t > d.intervalle * 3) {
      ecarts.push({ timeframe: d.timeframe,
        raison: `figée depuis ${Math.round((maintenant - d.t) / 60000)} min` });
    }
  }
  return {
    aligne: ecarts.length === 0,
    ecarts,
    raison: ecarts.length ? ecarts.map(e => `${e.timeframe || ''} ${e.raison}`.trim()).join(' ; ') : 'séries synchronisées'
  };
}

module.exports = { analyser, synchroniser, TF_MS, GRAVITE };
