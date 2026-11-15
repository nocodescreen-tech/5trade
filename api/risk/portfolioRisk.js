/**
 * 5trade — gestion du risque au niveau du portefeuille.
 *
 * Le moteur peut prendre plusieurs positions simultanées. Sans contrôle
 * du risque total, 5 positions corrélées à 1% chacune représentent un
 * risque réel de 5% (ou plus si corrélées). Ce module calcule le risque
 * total ouvert et bloque les nouvelles positions si la limite est atteinte.
 */

const { pairesCorrelees } = require('../delivery/trades');

/**
 * Calcule le risque total ouvert, en tenant compte des corrélations.
 *
 * Deux positions sur des paires corrélées ne comptent pas deux fois :
 * leur risque combiné est inférieur à la somme de leurs risques
 * individuels (le marché ne peut pas monter et descendre en même temps
 * sur deux paires corrélées).
 *
 * @param {Array} positions - Positions ouvertes [{ pair, direction, risk, size }]
 * @param {number} capital - Capital du compte
 * @returns {{ risqueTotalPct: number, risqueMaxPct: number, detail: Array }}
 */
function risqueTotal(positions, capital) {
  if (!positions || !positions.length) return { risqueTotalPct: 0, risqueMaxPct: 0, risqueAjustePct: 0, reductionCorrelation: 0, detail: [] };
  // Capital nul ou négatif : un refus CHIFFRÉ, pas une exception. Le dashboard
  // reçoit le capital de la configuration de risque ; une exception ici faisait
  // tomber tout l'écran au lieu d'afficher « risque non mesurable ».
  if (!capital || capital <= 0) {
    return {
      risqueTotalPct: null, risqueMaxPct: null, risqueAjustePct: null,
      reductionCorrelation: null, detail: [],
      raison: 'capital nul ou négatif : risque non mesurable'
    };
  }

  const detail = [];
  let risqueTotal = 0;
  let nonChiffrees = 0;

  for (const pos of positions) {
    const risk = Number(pos && pos.risk);
    const size = Number(pos && pos.size);
    // `risk` ou `size` absent (null, undefined, NaN) : la position n'est pas
    // « sans risque », elle est NON MESURÉE. L'ancien calcul
    // `(pos.risk || 0) * (pos.size || 0)` valait 0 et la faisait disparaître du
    // total : cinq positions non chiffrées s'affichaient « 0 % de risque
    // engagé », donc sous le plafond, donc feu vert pour en ouvrir d'autres.
    if (!Number.isFinite(risk) || !Number.isFinite(size) || risk <= 0 || size <= 0) {
      nonChiffrees++;
      detail.push({
        pair: pos && pos.pair,
        direction: pos && pos.direction,
        risquePct: null,
        risqueMontant: null,
        motif: 'risque ou taille non chiffré : position EXCLUE du total (pas comptée à zéro)'
      });
      continue;
    }
    const risqueMontant = risk * size;
    const risquePct = (risqueMontant / capital) * 100;
    risqueTotal += risquePct;
    detail.push({
      pair: pos.pair,
      direction: pos.direction,
      risquePct: +risquePct.toFixed(3),
      risqueMontant: +risqueMontant.toFixed(2)
    });
  }

  // Ajustement pour les corrélations : si deux positions sont corrélées
  // et dans le même sens, leur risque combiné est réduit de 30%.
  let reduction = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const p1 = positions[i], p2 = positions[j];
      const r1 = Number(p1 && p1.risk), s1 = Number(p1 && p1.size);
      const r2 = Number(p2 && p2.risk), s2 = Number(p2 && p2.size);
      if (!Number.isFinite(r1) || !Number.isFinite(s1) || !Number.isFinite(r2) || !Number.isFinite(s2)) continue;
      if (pairesCorrelees(p1.pair, p2.pair) && p1.direction === p2.direction) {
        const risque1 = r1 * s1 / capital * 100;
        const risque2 = r2 * s2 / capital * 100;
        reduction += Math.min(risque1, risque2) * 0.3;
      }
    }
  }

  const risqueAjuste = risqueTotal - reduction;
  // Aucune position chiffrée : le total n'existe pas. Rendre 0 serait dire
  // « aucun risque engagé », l'inverse de ce qu'on sait.
  const mesurable = nonChiffrees < positions.length;

  return {
    risqueTotalPct: mesurable ? +risqueTotal.toFixed(3) : null,
    risqueAjustePct: mesurable ? +risqueAjuste.toFixed(3) : null,
    reductionCorrelation: +reduction.toFixed(3),
    detail,
    nonChiffrees,
    ...(mesurable ? {} : { raison: 'aucune position chiffrée : risque non mesurable' })
  };
}

/**
 * Vérifie si une nouvelle position peut être ouverte sans dépasser
 * la limite de risque total.
 *
 * @param {object} params
 * @param {Array} params.positionsExistantes - Positions ouvertes
 * @param {number} params.capital - Capital du compte
 * @param {number} params.nouvelleRisquePct - Risque de la nouvelle position en %
 * @param {number} [params.limitePct] - Limite de risque total en % (défaut: 5)
 * @returns {{ ok: boolean, raison: string, risqueTotalPct: number, limitePct: number }}
 */
function peutOuvrirPosition({ positionsExistantes, capital, nouvelleRisquePct, limitePct = 5 }) {
  const { risqueAjustePct } = risqueTotal(positionsExistantes, capital);
  // `null + nombre` vaut `nombre` en JavaScript : sans cette garde, un capital
  // nul laissait passser la position comme si le portefeuille était vide.
  if (risqueAjustePct === null) {
    return {
      ok: false,
      raison: 'risque du portefeuille non mesurable (capital nul, ou aucune position chiffrée en risque et en taille)',
      risqueTotalPct: null, limitePct
    };
  }
  const risqueFutur = risqueAjustePct + nouvelleRisquePct;

  if (risqueFutur > limitePct) {
    return {
      ok: false,
      raison: `Risque total ${risqueFutur.toFixed(2)} % > limite ${limitePct} % — position refusée`,
      risqueTotalPct: +risqueFutur.toFixed(3),
      limitePct
    };
  }

  return {
    ok: true,
    raison: `Risque total ${risqueFutur.toFixed(2)} % ≤ limite ${limitePct} %`,
    risqueTotalPct: +risqueFutur.toFixed(3),
    limitePct
  };
}

/**
 * Calcule le risque par devise (ex: toutes les positions USD).
 *
 * @param {Array} positions - Positions ouvertes
 * @param {number} capital - Capital du compte
 * @returns {Object} Risque par devise { EUR: 1.2, USD: 2.3, ... }
 */
function risqueParDevise(positions, capital) {
  const parDevise = {};
  for (const pos of positions) {
    // `pair.slice(0, 3)` donnait 'FRX' pour frxXAUUSD, 'BTC' pour BTCUSDT et
    // 'R_7' pour R_75 : le risque « par devise » était faux pour tout ce qui
    // n'est pas une paire forex à 6 lettres. On réutilise le découpage unique.
    const { deviseDe } = require('../core/instruments');
    const devise = deviseDe(pos.pair);
    const risqueMontant = (pos.risk || 0) * (pos.size || 0);
    const risquePct = capital > 0 ? (risqueMontant / capital) * 100 : 0;
    parDevise[devise] = (parDevise[devise] || 0) + risquePct;
  }
  for (const d of Object.keys(parDevise)) {
    parDevise[d] = +parDevise[d].toFixed(3);
  }
  return parDevise;
}

module.exports = { risqueTotal, peutOuvrirPosition, risqueParDevise };
