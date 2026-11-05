/**
 * Strategy Engine — contrat d'une stratégie et contrôle de compatibilité.
 *
 * Une fiche de stratégie doit décrire une exécution, pas une intention. Ce module
 * valide la fiche (et le dit précisément quand elle est incomplète), puis vérifie
 * qu'elle peut réellement s'appliquer à un instrument, un régime et des unités de
 * temps donnés.
 *
 * Aucune fiche valide ne garantit une rentabilité : elle garantit seulement que
 * le moteur sait quoi exécuter.
 */

const CLASSES_CONNUES = ['forex', 'indices', 'metaux', 'energies', 'crypto', 'synthetique'];
const REGIMES_CONNUS = ['trending', 'ranging', 'volatil', 'faible volatilite', 'reversal'];
const TF_VALIDES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
const VERSION = /^\d+\.\d+\.\d+$/;

/**
 * Valide et normalise une fiche de stratégie.
 * @returns {{ok:boolean, erreurs:string[], avertissements:string[], fiche:object|null}}
 */
function valider(brut) {
  const erreurs = [];
  const avertissements = [];
  if (!brut || typeof brut !== 'object') {
    return { ok: false, erreurs: ['fiche absente ou non objet'], avertissements, fiche: null };
  }

  if (!brut.id || typeof brut.id !== 'string') erreurs.push('id manquant');
  if (!brut.name || typeof brut.name !== 'string') erreurs.push('name manquant');
  if (!VERSION.test(String(brut.version || ''))) erreurs.push('version absente ou non semver (x.y.z)');

  const marches = Array.isArray(brut.supportedMarkets) ? brut.supportedMarkets : [];
  if (!marches.length) erreurs.push('supportedMarkets vide : la stratégie ne déclare aucun marché');
  for (const m of marches) {
    if (!CLASSES_CONNUES.includes(m)) erreurs.push(`marché inconnu « ${m} » (attendu : ${CLASSES_CONNUES.join(', ')})`);
  }

  const regimes = brut.supportedRegimes === undefined ? null : brut.supportedRegimes;
  if (regimes !== null) {
    if (!Array.isArray(regimes)) erreurs.push('supportedRegimes doit être un tableau');
    else for (const r of regimes) {
      if (!REGIMES_CONNUS.includes(r)) erreurs.push(`régime inconnu « ${r} »`);
    }
  } else {
    avertissements.push('supportedRegimes non déclaré : la stratégie sera évaluée sur tous les régimes');
  }

  // Timeframes : objet {context, confirmation, execution} ou tableau simple.
  let tf = { context: [], confirmation: [], execution: [] };
  const tfs = brut.timeframes;
  if (Array.isArray(tfs)) {
    tf.execution = tfs.filter(t => TF_VALIDES.includes(t));
    if (tf.execution.length !== tfs.length) erreurs.push('timeframes : unité(s) invalide(s)');
  } else if (tfs && typeof tfs === 'object') {
    for (const role of ['context', 'confirmation', 'execution']) {
      const liste = Array.isArray(tfs[role]) ? tfs[role] : [];
      tf[role] = liste.filter(t => TF_VALIDES.includes(t));
      if (liste.length !== tf[role].length) erreurs.push(`timeframes.${role} : unité(s) invalide(s)`);
    }
  }
  const toutes = [...new Set([...tf.context, ...tf.confirmation, ...tf.execution])];
  if (!toutes.length) erreurs.push('aucune unité de temps exploitable');
  if (!tf.execution.length && toutes.length) {
    avertissements.push('aucune unité d\'exécution déclarée : la dernière des unités servira d\'exécution');
    tf.execution = [toutes[toutes.length - 1]];
  }

  // Conditions : le cœur de la fiche. Aucune condition obligatoire = aucun contrat.
  const requises = Array.isArray(brut.requiredConditions) ? brut.requiredConditions.filter(Boolean) : [];
  if (!requises.length) {
    erreurs.push('requiredConditions vide : sans condition obligatoire, la stratégie ne peut pas refuser un setup');
  }
  const optionnelles = Array.isArray(brut.optionalConditions) ? brut.optionalConditions.filter(Boolean) : [];
  const doublons = requises.filter(c => optionnelles.includes(c));
  if (doublons.length) erreurs.push(`condition(s) à la fois obligatoire(s) et optionnelle(s) : ${doublons.join(', ')}`);

  const risque = brut.riskModel || {};
  if (!risque.stopLoss) avertissements.push('riskModel.stopLoss non déclaré');
  if (!risque.takeProfit) avertissements.push('riskModel.takeProfit non déclaré');

  const ok = erreurs.length === 0;
  return {
    ok, erreurs, avertissements,
    fiche: ok ? {
      id: brut.id,
      name: brut.name,
      version: String(brut.version),
      supportedMarkets: [...new Set(marches)],
      supportedRegimes: regimes === null ? null : [...new Set(regimes)],
      timeframes: tf,
      requiredConditions: [...new Set(requises)],
      optionalConditions: [...new Set(optionnelles)],
      riskModel: { stopLoss: risque.stopLoss || null, takeProfit: risque.takeProfit || null },
      parameters: brut.parameters && typeof brut.parameters === 'object' ? brut.parameters : {}
    } : null
  };
}

/**
 * Compatibilité d'une fiche validée avec un profil de marché.
 * @returns {{compatible:boolean, bloquants:string[], avertissements:string[]}}
 */
function compatibilite(fiche, profil) {
  const bloquants = [];
  const avertissements = [];
  if (!fiche) return { compatible: false, bloquants: ['fiche de stratégie invalide'], avertissements };
  if (!profil || !profil.instrument) return { compatible: false, bloquants: ['profil de marché absent'], avertissements };

  const { instrument, regime } = profil;

  // Marché : la classe doit être explicitement déclarée. Un indice synthétique
  // n'est pas « du forex » : il n'est accepté que s'il est nommé.
  if (!instrument.reconnu) {
    bloquants.push(`instrument non identifié (${instrument.symbole}) : aucun profil à confronter`);
  } else if (!fiche.supportedMarkets.includes(instrument.classe)) {
    bloquants.push(`marché « ${instrument.classe} » non déclaré par la stratégie (${fiche.supportedMarkets.join(', ')})`);
  }

  // Régime : s'il est déclaré et connu, il doit être dans la liste.
  if (fiche.supportedRegimes && fiche.supportedRegimes.length) {
    if (!regime || !regime.regime || regime.regime === 'UNKNOWN') {
      bloquants.push('régime non déterminable : impossible de vérifier la compatibilité');
    } else if (!fiche.supportedRegimes.includes(regime.regime)) {
      bloquants.push(`régime « ${regime.regime} » hors des régimes déclarés (${fiche.supportedRegimes.join(', ')})`);
    }
    if (regime && Number.isFinite(regime.confiance) && regime.confiance < 0.5) {
      avertissements.push(`confiance du régime faible (${regime.confiance})`);
    }
  }

  // Unités de temps : si le profil dit lesquelles sont disponibles, on vérifie.
  if (Array.isArray(profil.timeframesDisponibles) && profil.timeframesDisponibles.length) {
    const manquantes = [...new Set([
      ...fiche.timeframes.context, ...fiche.timeframes.confirmation, ...fiche.timeframes.execution
    ])].filter(t => !profil.timeframesDisponibles.includes(t));
    if (manquantes.length) bloquants.push(`unité(s) de temps indisponible(s) : ${manquantes.join(', ')}`);
  }

  return { compatible: bloquants.length === 0, bloquants, avertissements };
}

module.exports = { valider, compatibilite, CLASSES_CONNUES, REGIMES_CONNUS, TF_VALIDES };
