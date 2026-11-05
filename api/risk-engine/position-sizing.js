/**
 * Risk Engine — dimensionnement de position sur les spécifications RÉELLES du
 * contrat (tick size, tick value, taille de lot).
 *
 * Ce module refuse plus souvent qu'il ne calcule, et c'est voulu :
 *  - sans tick value, aucune taille n'est calculable — on ne devine pas ;
 *  - un stop plus court que le spread est une perte programmée ;
 *  - une taille sous le lot minimum du courtier n'est pas exécutable.
 *
 * Formule : lots = (capital × risque%) / (distance en ticks × valeur du tick)
 */

const DEFAUT = { lotMin: 0.01, lotStep: 0.01, lotMax: 100, risqueMaxPct: 5 };

const nombre = v => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * @param {object} p { capital, risquePct, entree, stop, instrument }
 *   instrument : { tickSize, tickValue, tailleContrat, deviseCompte, spread }
 * @param {object} [options] { lotMin, lotStep, lotMax, risqueMaxPct }
 * @returns {{ok:boolean, raison?:string, manques?:string[], lots?:number,
 *            risqueMontant?:number, perteParLot?:number, ticks?:number,
 *            distance?:number, avertissements:string[]}}
 */
function dimensionner(p, options = {}) {
  const o = { ...DEFAUT, ...options };
  const avertissements = [];
  const capital = nombre(p && p.capital);
  const risquePct = nombre(p && p.risquePct);
  const entree = nombre(p && p.entree);
  const stop = nombre(p && p.stop);
  const inst = (p && p.instrument) || {};

  const manques = [];
  if (inst.tickSize === null || inst.tickSize === undefined) manques.push('tick size');
  if (inst.tickValue === null || inst.tickValue === undefined) manques.push('tick value');
  if (manques.length) {
    return { ok: false, avertissements,
      raison: `spécifications du contrat manquantes (${manques.join(', ')}) : ` +
        'aucune taille ne peut être calculée sans elles — le courtier doit les fournir' };
  }

  const tickSize = nombre(inst.tickSize);
  const tickValue = nombre(inst.tickValue);
  if (!tickSize || tickSize <= 0) return { ok: false, raison: 'tick size invalide', avertissements };
  if (!tickValue || tickValue <= 0) {
    return { ok: false, raison: 'tick value nulle ou invalide : risque par lot inconnu', avertissements };
  }

  if (!capital || capital <= 0) return { ok: false, raison: 'capital inconnu ou nul', avertissements };
  if (!risquePct || risquePct <= 0) return { ok: false, raison: 'risque par trade non défini', avertissements };
  if (risquePct > o.risqueMaxPct) {
    return { ok: false, raison: `risque ${risquePct}% au-delà du plafond de sécurité (${o.risqueMaxPct}%)`, avertissements };
  }
  if (!entree || !stop) return { ok: false, raison: 'entrée ou stop manquant', avertissements };

  const distance = Math.abs(entree - stop);
  if (distance <= 0) return { ok: false, raison: 'stop confondu avec l\'entrée', avertissements };

  // Stop plus court que le spread : on paierait le coût avant d'avoir commencé.
  const spread = nombre(inst.spread);
  if (spread !== null && spread > 0 && distance <= spread) {
    return { ok: false, avertissements,
      raison: `stop (${distance}) plus court que le spread (${spread}) : trade perdant par construction` };
  }

  const ticks = distance / tickSize;
  const perteParLot = ticks * tickValue;
  if (!Number.isFinite(perteParLot) || perteParLot <= 0) {
    return { ok: false, raison: 'risque par lot non calculable', avertissements };
  }

  const risqueMontant = capital * (risquePct / 100);
  let lots = risqueMontant / perteParLot;

  // Arrondi vers le BAS : dépasser le risque voulu n'est jamais acceptable.
  const pas = o.lotStep > 0 ? o.lotStep : 0.01;
  lots = Math.floor(lots / pas) * pas;
  lots = Math.round(lots * 1e8) / 1e8;

  if (lots < o.lotMin) {
    return { ok: false, avertissements,
      raison: `taille calculée ${lots} sous le lot minimum ${o.lotMin} : ` +
        'le risque demandé n\'est pas atteignable avec ce stop' };
  }
  if (lots > o.lotMax) {
    avertissements.push(`taille plafonnée à ${o.lotMax} lot(s) (calcul : ${lots})`);
    lots = o.lotMax;
  }

  const perteReelle = lots * perteParLot;
  if (perteReelle > risqueMontant * 1.0001) {
    return { ok: false, raison: 'incohérence interne : perte calculée supérieure au risque autorisé', avertissements };
  }

  return {
    ok: true, avertissements,
    lots, ticks: Math.round(ticks * 100) / 100,
    distance, perteParLot, risqueMontant,
    perteReelle: Math.round(perteReelle * 100) / 100,
    devise: inst.deviseCompte || null
  };
}

/**
 * Le trade est-il rentable APRÈS coûts ? Le coût est exprimé en unités de prix.
 * @param {object} p { entree, stop, objectif, cout, rrMin }
 */
function rentableApresFrais(p) {
  const entree = nombre(p && p.entree);
  const stop = nombre(p && p.stop);
  const objectif = nombre(p && p.objectif);
  const cout = nombre(p && p.cout) || 0;
  const rrMin = nombre(p && p.rrMin) || 0;
  if (!entree || !stop || !objectif) return { ok: false, raison: 'niveaux incomplets' };

  const risque = Math.abs(entree - stop);
  const gain = Math.abs(objectif - entree);
  if (risque <= 0) return { ok: false, raison: 'risque nul' };

  // Le coût est payé à l'entrée et à la sortie : il rogne le gain et gonfle le
  // risque effectif.
  const gainNet = gain - cout;
  const risqueNet = risque + cout;
  if (gainNet <= 0) return { ok: false, rrNet: 0, raison: 'coûts supérieurs au gain visé' };

  const rrBrut = gain / risque;
  const rrNet = gainNet / risqueNet;
  return {
    ok: rrNet >= rrMin, rrBrut: Math.round(rrBrut * 100) / 100,
    rrNet: Math.round(rrNet * 100) / 100, rrMin,
    raison: rrNet >= rrMin ? '' : `gain/risque net ${rrNet.toFixed(2)} < ${rrMin} après coûts`
  };
}

module.exports = { dimensionner, rentableApresFrais, DEFAUT };
