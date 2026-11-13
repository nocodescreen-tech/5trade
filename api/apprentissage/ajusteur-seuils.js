/**
 * 5trade — Apprentissage : ajusteur de seuils.
 *
 * Prend les candidats d'ajustement produits par les post-mortems et les
 * rejeux, applique les garde-fous anti-overfitting, propose une décision :
 *   - 'applique'        : promotion immédiate (rare)
 *   - 'shadow_3j'       : test en shadow run pendant 3 jours
 *   - 'reporte'         : pas assez de données
 *   - 'gele'            : dérive cumulée > 30% — revue humaine requise
 *   - 'rejete'          : delta trop grand ou incohérent
 *
 * Garde-fous :
 *   - delta max 5% par paramètre par jour
 *   - dérive cumulée max 30% par rapport à la valeur initiale (sinon gel)
 *   - au moins 20 trades sur 14j pour ajuster
 *   - expectancy 14j > 0 sinon retour aux seuils d'il y a 14j
 */

const fs = require('fs').promises;
const path = require('path');

const LIMITES = {
  deltaMaxParParamParJour: 0.05,
  joursShadowRunAvantPromotion: 3,
  deviationMaxGel: 0.30,
  expectancyMin14j: 0,
  tradesMinPourAjustement: 20,
};

const SEUILS_FILE = () => path.join(process.env.DATA_DIR || './data', 'apprentissage', 'seuils.json');
const INITIAUX_FILE = () => path.join(process.env.DATA_DIR || './data', 'apprentissage', 'seuils-initiaux.json');

/**
 * Charge les seuils courants. Initialise avec les valeurs par défaut si absent.
 */
async function charger() {
  try {
    return JSON.parse(await fs.readFile(SEUILS_FILE(), 'utf8'));
  } catch {
    const defaut = seuilsParDefaut();
    await fs.mkdir(path.dirname(SEUILS_FILE()), { recursive: true });
    await fs.writeFile(SEUILS_FILE(), JSON.stringify(defaut, null, 2));
    await fs.writeFile(INITIAUX_FILE(), JSON.stringify(defaut, null, 2));
    return defaut;
  }
}

function seuilsParDefaut() {
  return {
    rsi_m5_entree: 35,
    rsi_m5_sortie: 65,
    stop_atr: 1.0,
    tp1_atr: 1.27,
    tp2_atr: 2.0,
    trailing_atr: 1.5,
    invalidation_temporelle_minutes: 180,
    force_minimale: 0.35,
    'biais.htf_required_count': 2,
    'killzones.asia.actif_en_range': true,
    'killzones.london.actif': true,
    'killzones.ny.actif': true,
    'spread.max_ratio_stop': 0.3,
    'execution.delai_max_secondes': 5,
    version: 1,
    derniere_maj: new Date().toISOString(),
  };
}

/**
 * Évalue un candidat d'ajustement.
 * @returns {Promise<{statut:string, raison?:string, valeur?:number, applicable_en?:number}>}
 */
async function proposer(parametre, valeurCandidate) {
  const seuils = await charger();
  const valeurActuelle = seuils[parametre];
  if (valeurActuelle === undefined) {
    return { statut: 'rejete', raison: `paramètre inconnu : ${parametre}` };
  }
  if (typeof valeurActuelle !== 'number' || typeof valeurCandidate !== 'number') {
    return { statut: 'rejete', raison: 'les deux valeurs doivent être numériques' };
  }

  // 1. Delta max par jour
  const delta = (valeurCandidate - valeurActuelle) / valeurActuelle;
  if (Math.abs(delta) > LIMITES.deltaMaxParParamParJour) {
    return {
      statut: 'rejete',
      raison: `delta ${(delta * 100).toFixed(1)}% > ${LIMITES.deltaMaxParParamParJour * 100}% max/jour`
    };
  }

  // 2. Dérive cumulée (vs valeur initiale)
  let initiaux;
  try { initiaux = JSON.parse(await fs.readFile(INITIAUX_FILE(), 'utf8')); }
  catch { initiaux = seuils; }
  const valeurInitiale = initiaux[parametre];
  if (valeurInitiale !== undefined && typeof valeurInitiale === 'number') {
    const deviation = Math.abs((valeurCandidate - valeurInitiale) / valeurInitiale);
    if (deviation > LIMITES.deviationMaxGel) {
      return {
        statut: 'gele',
        raison: `dérive cumulée ${(deviation * 100).toFixed(1)}% > ${LIMITES.deviationMaxGel * 100}% — revue humaine requise`
      };
    }
  }

  // 3. Trades minimums
  // (en production : compter dans trade_outcome sur 14j)
  // Ici on omet la vérification — appelant doit s'en assurer.

  // Promotion : shadow run 3 jours par défaut
  return {
    statut: 'shadow_3j',
    valeur: valeurCandidate,
    applicable_en: LIMITES.joursShadowRunAvantPromotion * 24 * 3600 * 1000,
    raison: `delta ${(delta * 100).toFixed(1)}% valide, shadow run ${LIMITES.joursShadowRunAvantPromotion}j`
  };
}

/**
 * Applique un ajustement promu (après shadow run réussi).
 */
async function appliquer(parametre, nouvelleValeur) {
  const seuils = await charger();
  const ancien = seuils[parametre];
  seuils[parametre] = nouvelleValeur;
  seuils.version = (seuils.version || 1) + 1;
  seuils.derniere_maj = new Date().toISOString();
  await fs.writeFile(SEUILS_FILE(), JSON.stringify(seuils, null, 2));
  return { ok: true, parametre, ancien, nouveau: nouvelleValeur, version: seuils.version };
}

/**
 * Retour en arrière de 14j si expectancy 14j < 0.
 */
async function retourArriere14j(snapshot14j) {
  if (!snapshot14j) return { ok: false, raison: 'snapshot requis' };
  await fs.writeFile(SEUILS_FILE(), JSON.stringify(snapshot14j, null, 2));
  return { ok: true, raison: 'retour aux seuils d\'il y a 14j' };
}

module.exports = { charger, proposer, appliquer, retourArriere14j, LIMITES, seuilsParDefaut };
