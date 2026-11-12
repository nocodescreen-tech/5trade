/**
 * 5trade — garde-fou des niveaux publiés, partagé par les DEUX moteurs.
 *
 * La règle était appliquée aux motifs et aux stratégies, mais le verdict du
 * direct (`Signals.detect` → `levelsFor`) publiait ses niveaux SANS passer par
 * elle : mesuré sur 42 verdicts réels, 28 avaient des niveaux et **9 (32 %)
 * sortaient avec un stop à moins de 0,5 ATR** de l'entrée. D'où ce module :
 * une seule implémentation, requise par `signals.js` et `signaux.js`.
 */

/** Décimales utiles d'un prix : 2 au-dessus de 100, 4 au-dessus de 1, 6 en dessous. */
const decimales = x => (Math.abs(x) >= 100 ? 2 : Math.abs(x) >= 1 ? 4 : 6);

/**
 * Arrondi d'un prix.
 *
 * Un prix ne s'arrondit pas comme un multiple d'ATR ou un ratio : sur EUR/USD à
 * 1,1234, arrondir à 2 décimales donnait la même valeur pour l'entrée et le
 * stop — mesuré, 61 risques sur 62 à zéro sur cet actif.
 */
const arrondiPrix = x => (Number.isFinite(x) ? +x.toFixed(decimales(x)) : null);

/** Un pas de précision : la plus petite variation représentable à ce prix. */
const pasPrix = x => 10 ** -decimales(x);

/**
 * Assainit des niveaux avant de les publier.
 *
 * Deux défauts mesurés sur le journal réel (276 signaux) :
 *  1. **Stop trop près.** 11 % des stops étaient à moins de 0,5 ATR de l'entrée,
 *     les pires à 0,09 ATR. Un tel stop n'est pas une invalidation, c'est du
 *     bruit : il se fait balayer par la mèche suivante, et il gonfle ensuite le
 *     R des gains (un risque de 0,1 ATR transforme +1 ATR en +10 R).
 *  2. **Stop du mauvais côté.** Un achat avec un stop AU-DESSUS de l'entrée
 *     n'est pas un trade : c'est une géométrie cassée. On refuse.
 *
 * @param {{entree:number, stop:number, objectifs:number[]}} niv
 * @param {'long'|'short'} sens
 * @param {number} atr
 * @param {number} [risqueMini] plancher en multiples d'ATR (0,5 par défaut)
 */
function assainirNiveaux(niv, sens, atr, risqueMini = 0.5) {
  if (!niv || !Number.isFinite(niv.entree) || !Number.isFinite(niv.stop)) return niv;
  const long = sens === 'long';

  // Stop du mauvais côté : la configuration est incohérente, on ne la publie pas.
  if (long ? niv.stop >= niv.entree : niv.stop <= niv.entree) return null;

  // ── Objectifs du mauvais côté ────────────────────────────────────────────
  // Trouvé sur données réelles : des « Double top » vendaient à 4109,97 avec un
  // premier objectif à 4114,32 — AU-DESSUS de l'entrée. Le prix l'atteint donc
  // immédiatement, le trade est compté « objectif atteint » et le R calculé sort
  // NÉGATIF. Un gagnant ne peut pas retirer du R.
  //
  // Un objectif situé du mauvais côté n'est pas un objectif : c'est un niveau
  // déjà franchi. On refuse si la cible PROCHE est invalide, et on tronque les
  // suivantes — jamais l'inverse, sinon `objectifs[0]` et `objectifs[1]` se
  // décalent et le suivi TP1/TP2 devient faux.
  const cote = o => Number.isFinite(o) && (long ? o > niv.entree : o < niv.entree);
  const brut = Array.isArray(niv.objectifs) ? niv.objectifs : [];
  if (!brut.length || !cote(brut[0])) return null;

  // ORDRE DES OBJECTIFS. `journal-signaux` suppose objectifs[0] = TP1 et
  // objectifs[1] = TP2. Deux cibles du bon côté mais INVERSÉES (90 puis 95 pour
  // une vente à 100) passaient le contrôle : le suivi enregistrait alors TP1
  // atteint après TP2, et la progression du trade devenait fausse.
  // On ne réinterprète pas : on refuse un tableau mal ordonné.
  const valides = brut.filter(cote);
  // L'ordre se juge sur les cibles RETENUES : une cible du mauvais côté est
  // écartée (comme avant) et ne doit pas invalider l'ordre des autres.
  const ordonnes = valides.every((o, i) => i === 0 || (long ? o > valides[i - 1] : o < valides[i - 1]));
  if (!ordonnes) return null;
  const ecartes = brut.length - valides.length;

  if (!(atr > 0)) return ecartes ? { ...niv, objectifs: valides } : niv;
  const ecart = Math.abs(niv.entree - niv.stop);
  const mini = atr * risqueMini;
  if (ecart >= mini) return ecartes ? { ...niv, objectifs: valides } : niv;

  // Le plancher doit tenir sur le prix PUBLIÉ, pas sur la valeur avant arrondi :
  // arrondir 2045.410000 à 2 décimales ramenait le stop à 0,4999 ATR, donc sous
  // le plancher qu'on vient d'imposer. On éloigne d'un pas tant que nécessaire.
  let stop = arrondiPrix(long ? niv.entree - mini : niv.entree + mini);
  for (let i = 0; i < 5 && Math.abs(niv.entree - stop) < mini; i++) {
    stop = arrondiPrix(long ? stop - pasPrix(stop) : stop + pasPrix(stop));
  }
  return {
    ...niv,
    objectifs: valides,
    stop,
    stopElargi: true,
    base: [niv.base, `stop élargi à ${risqueMini}× ATR (le niveau était à ${arrondiPrix(ecart)} du prix)`,
      ecartes ? `${ecartes} objectif(s) écarté(s) : du mauvais côté de l'entrée` : null]
      .filter(Boolean).join(' · ')
  };
}

module.exports = { assainirNiveaux, arrondiPrix };
