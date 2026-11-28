/**
 * 5trade — Apprentissage : ajusteur de seuils.
 *
 * Prend les candidats d'ajustement produits par les post-mortems et les
 * rejeux, applique les garde-fous anti-overfitting, propose une décision :
 *   - 'shadow_3j'       : test en shadow run pendant 3 jours
 *   - 'en_revue'        : preuves suffisantes, décision humaine requise
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
    // Objectifs en R — les VRAIS multiples utilisés par le générateur. Les deux
    // lignes `_atr` ci-dessus étaient des multiples d'ATR utilisés par l'ancien
    // rejeu factice ; elles restent pour ne pas casser les anciens journaux.
    tp1_r: 1.27,
    tp2_r: 2.0,
    trailing_atr: 1.5,
    invalidation_temporelle_minutes: 180,
    invalidation_seuil_r: 0.3,          // progrès en R exigé pour ne pas couper au délai
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
async function proposer(parametre, valeurCandidate, preuve = {}) {
  const seuils = await charger();
  const valeurActuelle = seuils[parametre];
  if (valeurActuelle === undefined) {
    return { statut: 'rejete', raison: `paramètre inconnu : ${parametre}` };
  }
  if (!Number.isFinite(valeurActuelle) || !Number.isFinite(valeurCandidate) || valeurActuelle===0 || ['version'].includes(parametre)) {
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

  if(!Number.isSafeInteger(preuve.trades)||preuve.trades<LIMITES.tradesMinPourAjustement) return {statut:'reporte',raison:'Échantillon insuffisant'};
  if(valeurActuelle===valeurCandidate)return {statut:'rejete',raison:'Valeur inchangée'};
  const shadow=await enregistrerShadow(parametre,valeurCandidate,preuve);
  // Candidate enregistré ; aucune modification en production.
  return {
    statut: 'shadow_3j',
    valeur: valeurCandidate,
    shadow,
    applicable_en: LIMITES.joursShadowRunAvantPromotion * 24 * 3600 * 1000,
    raison: `delta ${(delta * 100).toFixed(1)}% valide, shadow run ${LIMITES.joursShadowRunAvantPromotion}j`
  };
}

/**
 * Ajustement d'un paramètre BASCULE (booléen) : couper une killzone, activer un
 * filtre. Le garde-fou en pourcentage ne s'applique pas à un booléen — le vrai
 * risque est de couper une séance sur trois trades. On exige donc le même
 * échantillon minimum que pour un seuil numérique, et on passe par un shadow
 * run de 3 jours avant promotion.
 *
 * @param {string} parametre
 * @param {boolean} valeurCandidate
 * @param {{trades:number}} [preuve]
 */
async function proposerBascule(parametre, valeurCandidate, preuve = {}) {
  const seuils = await charger();
  if (!(parametre in seuils)) {
    return { statut: 'rejete', raison: `paramètre inconnu : ${parametre}` };
  }
  if (typeof seuils[parametre] !== 'boolean') {
    return { statut: 'rejete', raison: `${parametre} n’est pas une bascule (valeur actuelle : ${JSON.stringify(seuils[parametre])})` };
  }
  if (typeof valeurCandidate !== 'boolean') {
    return { statut: 'rejete', raison: 'la valeur candidate doit être true ou false' };
  }
  if (seuils[parametre] === valeurCandidate) {
    return { statut: 'rejete', raison: `${parametre} vaut déjà ${valeurCandidate}` };
  }
  const trades = Number(preuve.trades) || 0;
  if (trades < LIMITES.tradesMinPourAjustement) {
    return {
      statut: 'reporte',
      raison: `${trades} trade(s) < ${LIMITES.tradesMinPourAjustement} requis : pas d’ajustement sur un échantillon court`
    };
  }
  const entree = await enregistrerShadow(parametre, valeurCandidate, preuve);
  return {
    statut: 'shadow_3j',
    valeur: valeurCandidate,
    applicable_en: LIMITES.joursShadowRunAvantPromotion * 24 * 3600 * 1000,
    shadow: entree,
    raison: `${trades} trades, shadow run ${LIMITES.joursShadowRunAvantPromotion}j avant promotion`
  };
}

// ── Shadow runs : c'est ce qui manquait ──────────────────────────────────────
// `proposer()` renvoyait « shadow_3j » et rien n'enregistrait la candidature :
// le statut était un mot, pas un état. Rien n'était jamais promu, donc les
// seuils ne bougeaient jamais — l'apprentissage affichait un mécanisme éteint.
const SHADOW_FILE = () => path.join(process.env.DATA_DIR || './data', 'apprentissage', 'shadow.json');

async function lireShadow() {
  try {
    const j = JSON.parse(await fs.readFile(SHADOW_FILE(), 'utf8'));
    return Array.isArray(j.candidats) ? j : { candidats: [] };
  } catch {
    return { candidats: [] };
  }
}

async function ecrireShadow(doc) {
  await fs.mkdir(path.dirname(SHADOW_FILE()), { recursive: true });
  await fs.writeFile(SHADOW_FILE(), JSON.stringify(doc, null, 2));
  return doc;
}

async function enregistrerShadow(parametre, valeur, preuve = {}) {
  const doc = await lireShadow();
  const maintenant = Date.now();
  const entree = {
    id: require('node:crypto').randomUUID(),
    baselineVersion:(await charger()).version,
    parametre,
    valeur,
    decide_at: new Date(maintenant).toISOString(),
    applicable_at: new Date(maintenant + LIMITES.joursShadowRunAvantPromotion * 24 * 3600 * 1000).toISOString(),
    preuve,
    statut: 'shadow'
  };
  const existing=doc.candidats.find(c=>['shadow','reporte_shadow','en_revue'].includes(c.statut)&&c.parametre===parametre&&c.valeur===valeur);
  if(existing)return existing;
  doc.candidats.push(entree);
  await ecrireShadow(doc);
  return entree;
}

/** Liste des candidatures encore actives (shadow ou en attente de revue). */
async function shadowEnCours() {
  const doc = await lireShadow();
  const maintenant = Date.now();
  return doc.candidats.filter(c =>
    ['shadow','reporte_shadow','en_revue'].includes(c.statut));
}

/**
 * Évalue les candidatures arrivées à échéance. Une période positive ouvre une
 * revue humaine ; elle ne modifie jamais les seuils automatiquement. Un shadow
 * déficitaire est abandonné avec son motif et reste traçable.
 *
 * @param {{expectancyR:number, trades:number}} bilan bilan de la période écoulée
 */
async function promouvoirEchues(bilan = {}) {
  const doc = await lireShadow();
  const maintenant = Date.now();
  const decisions = [];

  for (const c of doc.candidats) {
    if (!['shadow','reporte_shadow'].includes(c.statut) || Date.parse(c.applicable_at) > maintenant) continue;
    const proof=Array.isArray(bilan.candidates)?bilan.candidates.find(p=>p.id===c.id&&p.baselineVersion===c.baselineVersion):null;
    const valid=proof&&proof.outOfSample===true&&proof.costsKnown===true&&Number.isFinite(proof.expectancyR)&&Number.isFinite(proof.baselineExpectancyR)&&Number.isSafeInteger(proof.trades)&&proof.from>=Date.parse(c.decide_at)&&proof.to<=maintenant&&proof.to>proof.from;
    const expectancy=valid?proof.expectancyR:null;
    const trades=valid?proof.trades:0;

    if (trades < LIMITES.tradesMinPourAjustement) {
      c.statut = 'reporte_shadow';
      c.raison = `échéance atteinte mais ${trades} trade(s) < ${LIMITES.tradesMinPourAjustement} : shadow prolongé`;
      decisions.push({ parametre: c.parametre, decision: c.statut, raison: c.raison });
      continue;
    }
    if (expectancy <= LIMITES.expectancyMin14j || expectancy <= proof.baselineExpectancyR) {
      c.statut = 'abandonnee';
      c.raison = `espérance ${expectancy} R non supérieure au seuil ou à la référence : candidature abandonnée`;
      decisions.push({ parametre: c.parametre, decision: c.statut, raison: c.raison });
      continue;
    }

    c.statut = 'en_revue';
    c.revue_demandee_at = new Date().toISOString();
    c.bilan = { expectancyR: expectancy, trades, baselineExpectancyR:proof.baselineExpectancyR, from:proof.from,to:proof.to,costsKnown:true };
    c.raison = `preuves suffisantes (${Number.isFinite(expectancy) ? expectancy : 'n/a'} R sur ${trades} trades) — approbation humaine requise`;
    decisions.push({ id: c.id, parametre: c.parametre, valeur: c.valeur,
      decision: 'revue_requise', bilan: c.bilan, raison: c.raison });
  }

  await ecrireShadow(doc);
  return decisions;
}

/**
 * Décision humaine explicite sur une candidature arrivée en revue.
 * La note et l'identité sont conservées avec la décision. Aucun autre statut
 * ne peut être appliqué, ce qui empêche de court-circuiter le shadow run.
 */
let fileRevue = Promise.resolve();

function revoirCandidature(id, revue = {}) {
  const operation = () => revoirCandidatureSerialisee(id, revue);
  const resultat = fileRevue.then(operation, operation);
  // La file doit continuer même si une écriture inattendue échoue.
  fileRevue = resultat.catch(() => {});
  return resultat;
}

async function revoirCandidatureSerialisee(id, revue = {}) {
  const decision = String(revue.decision || '').trim().toLowerCase();
  const reviewer = String(revue.reviewer || '').trim().slice(0, 120);
  const note = String(revue.note || '').trim().slice(0, 1000);
  if (!id || !['approuver', 'rejeter'].includes(decision)) {
    return { ok: false, raison: 'décision attendue : approuver ou rejeter' };
  }
  if (!reviewer || note.length < 8) {
    return { ok: false, raison: 'identité du relecteur et note motivée requises' };
  }

  const doc = await lireShadow();
  const candidat = doc.candidats.find(c => c.id === id);
  if (!candidat) return { ok: false, raison: 'candidature introuvable' };
  if (candidat.statut !== 'en_revue') {
    return { ok: false, raison: `candidature non révisable (statut ${candidat.statut})` };
  }

  const reviewedAt = new Date().toISOString();
  candidat.reviewer = reviewer;
  candidat.note_revue = note;
  candidat.reviewed_at = reviewedAt;

  if (decision === 'rejeter') {
    candidat.statut = 'rejetee_humain';
    candidat.raison = `rejetée par ${reviewer} : ${note}`;
    await ecrireShadow(doc);
    return { ok: true, id, decision: 'rejetee', reviewer, note, reviewedAt };
  }

  const current=await charger();
  if(current.version!==candidat.baselineVersion || !candidat.bilan?.costsKnown) return {ok:false,raison:'Référence modifiée ou preuve absente : nouvelle évaluation requise'};
  const applique = await appliquer(candidat.parametre, candidat.valeur);
  candidat.statut = 'approuvee';
  candidat.ancien = applique.ancien;
  candidat.nouveau = applique.nouveau;
  candidat.raison = `approuvée par ${reviewer} : ${note}`;
  await ecrireShadow(doc);
  return { ok: true, id, decision: 'approuvee', reviewer, note, reviewedAt,
    parametre: candidat.parametre, ancien: applique.ancien, nouveau: applique.nouveau };
}


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

module.exports = {
  charger, proposer, proposerBascule, appliquer, retourArriere14j,
  promouvoirEchues, shadowEnCours, enregistrerShadow, revoirCandidature,
  LIMITES, seuilsParDefaut
};
