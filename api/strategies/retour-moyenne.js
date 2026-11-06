/**
 * Stratégie « Retour à la moyenne sur excès de volatilité ».
 *
 * Écrite de zéro, avec SA logique — pas une combinaison de règles génériques.
 * Elle ne dépend pas du détecteur de structure : elle a ses conditions, son plan,
 * ses sorties, et elle est jugée sur ses propres trades.
 *
 * IDÉE
 *   Sur un instrument qui oscille autour d'un niveau (indices synthétiques,
 *   crypto en range), une clôture très éloignée de sa moyenne à court terme
 *   revient souvent vers elle. On ne prend ce pari QUE si trois choses sont
 *   vraies en même temps :
 *     1. l'écart est statistiquement rare      |z| ≥ 2,0 sur 20 bougies ;
 *     2. le marché n'est pas en tendance forte  ratio d'efficacité < 0,35 ;
 *     3. la volatilité permet de placer un stop  ATR > 0 et distance ≥ 0,8 ATR.
 *   Le stop se place à 1,5 ATR (au-delà du bruit ordinaire), l'objectif est la
 *   moyenne elle-même. Si l'objectif vaut moins de 1 R, on ne prend pas le trade.
 *
 * CE QUE LA STRATÉGIE REFUSE
 *   - pas d'écart significatif        → pas de trade (le cas normal)
 *   - tendance forte en cours         → pas de trade : le retour à la moyenne y
 *                                       échoue précisément quand ça compte
 *   - objectif trop proche            → pas de trade, les frais mangeraient tout
 */

const PERIODE_MOYENNE = 20;
const Z_ENTREE = 2.0;
const EFFICACITE_MAX = 0.35;
const ATR_STOP = 1.5;
const RR_MIN = 1.0;
const DUREE_MAX = 40;

function moyenne(valeurs) {
  if (!valeurs.length) return null;
  return valeurs.reduce((a, b) => a + b, 0) / valeurs.length;
}

function ecartType(valeurs, moy) {
  if (valeurs.length < 2) return null;
  const m = moy === undefined ? moyenne(valeurs) : moy;
  const variance = valeurs.reduce((a, b) => a + (b - m) ** 2, 0) / (valeurs.length - 1);
  return Math.sqrt(variance);
}

function atr(bougies, periode = 14) {
  if (bougies.length < periode + 2) return null;
  const vrais = [];
  for (let i = bougies.length - periode; i < bougies.length; i++) {
    const b = bougies[i], p = bougies[i - 1];
    vrais.push(Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)));
  }
  return moyenne(vrais);
}

/**
 * Ratio d'efficacité : mouvement net / chemin parcouru, entre 0 et 1.
 * 1 = tendance parfaite, 0 = aller-retour permanent. C'est le filtre qui dit
 * « ne fais pas de retour à la moyenne dans un trend ».
 */
function efficacite(closes, n = 20) {
  if (closes.length < n + 1) return null;
  const fenetre = closes.slice(-(n + 1));
  const net = Math.abs(fenetre[fenetre.length - 1] - fenetre[0]);
  let chemin = 0;
  for (let i = 1; i < fenetre.length; i++) chemin += Math.abs(fenetre[i] - fenetre[i - 1]);
  return chemin > 0 ? net / chemin : 0;
}

/**
 * Évalue une fenêtre de bougies et rend soit un plan, soit la raison du refus.
 * @returns {{trade:object|null, raison:string, mesure:object}}
 */
function evaluer(bougies, options = {}) {
  const zSeuil = Number.isFinite(options.zEntree) ? options.zEntree : Z_ENTREE;
  const effMax = Number.isFinite(options.efficaciteMax) ? options.efficaciteMax : EFFICACITE_MAX;
  const atrStop = Number.isFinite(options.atrStop) ? options.atrStop : ATR_STOP;

  if (!Array.isArray(bougies) || bougies.length < PERIODE_MOYENNE + 20) {
    return { trade: null, raison: 'historique insuffisant', mesure: {} };
  }
  const closes = bougies.map(b => b.c);
  const fenetre = closes.slice(-PERIODE_MOYENNE);
  const moy = moyenne(fenetre);
  const ec = ecartType(fenetre, moy);
  const a = atr(bougies);
  const eff = efficacite(closes);
  const last = bougies[bougies.length - 1];

  const mesure = {
    moyenne: moy === null ? null : +moy.toFixed(5),
    ecartType: ec === null ? null : +ec.toFixed(5),
    z: (ec && ec > 0) ? +((last.c - moy) / ec).toFixed(2) : null,
    atr: a === null ? null : +a.toFixed(5),
    efficacite: eff === null ? null : +eff.toFixed(2)
  };

  if (!ec || ec <= 0 || !a || a <= 0) {
    return { trade: null, raison: 'volatilité non mesurable', mesure };
  }
  const z = (last.c - moy) / ec;
  if (Math.abs(z) < zSeuil) {
    return { trade: null, raison: `écart insuffisant (z ${z.toFixed(2)} < ${zSeuil})`, mesure };
  }
  if (eff !== null && eff > effMax) {
    return { trade: null, raison: `tendance trop forte (efficacité ${eff.toFixed(2)} > ${effMax}) : pas de retour à la moyenne`, mesure };
  }

  // Sens : on revient VERS la moyenne.
  const sens = z > 0 ? 'SELL' : 'BUY';
  const entree = last.c;
  const stop = sens === 'BUY' ? entree - atrStop * a : entree + atrStop * a;
  const objectif = moy;
  const risque = Math.abs(entree - stop);
  const gain = Math.abs(objectif - entree);
  const rr = risque > 0 ? gain / risque : 0;

  if (risque < 0.8 * a) {
    return { trade: null, raison: 'stop trop serré pour la volatilité', mesure };
  }
  if (rr < RR_MIN) {
    return { trade: null, raison: `objectif trop proche (${rr.toFixed(2)} R < ${RR_MIN} R)`, mesure };
  }

  return {
    trade: {
      sens, entree, stop, objectif, rr: +rr.toFixed(2),
      z: +z.toFixed(2), efficacite: eff === null ? null : +eff.toFixed(2),
      atr: a
    },
    raison: 'setup complet',
    mesure
  };
}

module.exports = {
  evaluer, atr, efficacite, moyenne, ecartType,
  PARAMETRES: { PERIODE_MOYENNE, Z_ENTREE, EFFICACITE_MAX, ATR_STOP, RR_MIN, DUREE_MAX }
};
