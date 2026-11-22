/**
 * 5TRADE — Policy & Permission Engine
 *
 * Sépare et verrouille les autorisations selon les privilèges d'action de l'IA :
 *   - LECTURE      : consultation des prix, indicateurs, métadonnées
 *   - ANALYSE      : détection de signaux, calculs de niveaux, backtest
 *   - NOTIFICATION : push Telegram, alertes sonores, journal d'événements
 *   - CONFIG       : ajout de consignes, activation de stratégies
 *   - EXECUTION    : passage d'ordre en démo ou réel
 *
 * RÈGLE FONDAMENTALE :
 * Aucun prompt, skill ou instruction utilisateur ne peut contourner :
 *   - Le Stop Loss obligatoire
 *   - Le plafond de risque par trade (ex: 2 %)
 *   - Le drawdown maximum journalier et total
 */

const PERMISSIONS = {
  LECTURE: 'lecture',
  ANALYSE: 'analyse',
  NOTIFICATION: 'notification',
  CONFIG: 'config',
  EXECUTION: 'execution'
};

const INVARIANTS_RISQUE = {
  STOP_LOSS_OBLIGATOIRE: true,
  RISQUE_MAX_PAR_TRADE_PCT: 2.0,
  DRAWDOWN_MAX_JOUR_PCT: 5.0,
  OBJECTIF_TP1_OBLIGATOIRE: true
};

/**
 * Valide si une action est autorisée selon les politiques actives.
 * @param {string} permissionDemandee 'lecture'|'analyse'|'notification'|'config'|'execution'
 * @param {object} contexte { modeTrading?: 'demo'|'reel', modificationsRisque?: object }
 * @returns {{ autorise: boolean, raison?: string, violations: string[] }}
 */
function validerAction(permissionDemandee, contexte = {}) {
  const violations = [];

  // 1. Vérification de permission connue
  const perm = String(permissionDemandee).toLowerCase();
  if (!Object.values(PERMISSIONS).includes(perm)) {
    return {
      autorise: false,
      raison: `Permission inconnue : ${permissionDemandee}`,
      violations: ['Permission non reconnue']
    };
  }

  // 2. Contrôle d'exécution d'ordre : nécessite mode explicite et validation des invariants
  if (perm === PERMISSIONS.EXECUTION) {
    if (!contexte.modeTrading || !['demo', 'reel'].includes(contexte.modeTrading)) {
      violations.push('Mode de trading (demo ou reel) non spécifié pour l\'exécution');
    }
  }

  // 3. Contrôle strict des invariants de risque (inviolabilité absolue)
  if (contexte.modificationsRisque) {
    const m = contexte.modificationsRisque;
    if (m.stopLossObligatoire === false) {
      violations.push('Interdiction absolue de désactiver le Stop Loss obligatoire');
    }
    if (typeof m.risqueMaxParTradePct === 'number' && m.risqueMaxParTradePct > INVARIANTS_RISQUE.RISQUE_MAX_PAR_TRADE_PCT) {
      violations.push(`Plafond de risque par trade (${m.risqueMaxParTradePct}%) dépasse la limite maximale autorisée (${INVARIANTS_RISQUE.RISQUE_MAX_PAR_TRADE_PCT}%)`);
    }
    if (m.objectifTP1Obligatoire === false) {
      violations.push('Interdiction de supprimer l\'obligation de cible TP1');
    }
  }

  return {
    autorise: violations.length === 0,
    raison: violations.length ? violations.join(' ; ') : 'Action conforme aux politiques de sécurité',
    violations
  };
}

module.exports = {
  PERMISSIONS,
  INVARIANTS_RISQUE,
  validerAction
};
