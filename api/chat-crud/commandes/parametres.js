/**
 * Chat CRUD — Commandes PARAMÈTRES (seuils du système).
 * Verbes : MONTRE, MODIFIE.
 */

const Ajusteur = require('../../apprentissage/ajusteur-seuils');
const { extraireModification } = require('../parseur');

async function lister(sujet, ctx) {
  const seuils = await Ajusteur.charger();
  const items = Object.entries(seuilsEnItems(seuils));
  return { items: items.map(([k, v]) => ({ parametre: k, valeur: v })) };
}

function seuilsEnItems(seuils) {
  const out = {};
  for (const [k, v] of Object.entries(seuils)) {
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

async function modifier(sujet, ctx) {
  const extrait = extraireModification(sujet);
  if (!extrait || !extrait.parametre || extrait.valeur === null) {
    return {
      erreur: 'syntaxe : « modifie le stop ATR à 1.2 sur XAUUSD »',
      raison: 'paramètre et valeur attendus'
    };
  }
  const proposition = await Ajusteur.proposer(extrait.parametre, extrait.valeur);
  if (proposition.statut === 'rejete' || proposition.statut === 'gele') {
    return { statut: proposition.statut, raison: proposition.raison };
  }
  // Appliquer immédiatement si shadow run accepté
  if (proposition.statut === 'shadow_3j') {
    // En production : ne pas appliquer immédiatement, attendre 3j
    // Ici on enregistre la candidature
    return {
      ok: true,
      parametre: extrait.parametre,
      ancien: (await Ajusteur.charger())[extrait.parametre],
      nouveau: extrait.valeur,
      applicable_en: proposition.applicable_en,
      raison: `candidat enregistré — ${proposition.raison}`
    };
  }
  if (proposition.statut === 'applique') {
    const r = await Ajusteur.appliquer(extrait.parametre, extrait.valeur);
    return r;
  }
  return { statut: proposition.statut, raison: proposition.raison };
}

module.exports = { lister, modifier };
