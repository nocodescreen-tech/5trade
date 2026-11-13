/**
 * Chat CRUD — Commandes STRATEGIES.
 * Verbes : MONTRE (lister), ACTIVE / DÉSACTIVE, SUPPRIME.
 *
 * Défaut corrigé : ce module appelait `Registry.lister/creer/activer/
 * desactiver`, qui n'existent pas — `strategy-engine/registry.js` ne gère que
 * les VERSIONS (enregistrer, derniere, comparerVersions…). Résultat mesuré :
 * « montre les stratégies » répondait « Registry.lister is not a function ».
 *
 * Les fiches vivent dans `core/db.js` (listStrategies / saveStrategyRecord /
 * removeStrategyRecord). Le champ `actif` n'existait pas : il est créé ici, et
 * `strategy-engine/selector.js` le LIT — sinon désactiver ne désactiverait rien.
 */

const DB = require('../../core/db');

const idDe = sujet => (sujet.match(/(strategy_[A-Za-z0-9_-]+)/i) || [])[1]
  || (sujet.match(/#?([A-Za-z0-9_-]{3,40})\s*$/) || [])[1] || null;

async function lister(sujet) {
  const toutes = await DB.listStrategies();
  const actives = toutes.filter(s => s.actif !== false);
  const inactives = toutes.filter(s => s.actif === false);
  const seulementActives = /actives?/i.test(sujet) && !/inactives?|toutes/i.test(sujet);
  return {
    actives: (seulementActives ? actives : toutes).slice(0, 40).map(s => ({
      id: s.id, titre: s.title || s.titre || s.id, actif: s.actif !== false,
      regles: (s.moteur && s.moteur.regles) || s.regles || [],
      marches: s.marches || []
    })),
    total: toutes.length,
    nbActives: actives.length,
    nbInactives: inactives.length
  };
}

/** Bascule le drapeau et vérifie qu'il est bien écrit. */
async function basculer(sujet, actif) {
  const id = idDe(sujet);
  if (!id) return { erreur: 'quelle stratégie ?', raison: 'donne son identifiant (strategy_trend…)' };
  const toutes = await DB.listStrategies();
  const fiche = toutes.find(s => s.id === id);
  if (!fiche) return { erreur: `stratégie « ${id} » introuvable`, disponibles: toutes.slice(0, 10).map(s => s.id) };
  if ((fiche.actif !== false) === actif) {
    return { ok: true, id, inchange: true, raison: `déjà ${actif ? 'active' : 'inactive'}` };
  }
  await DB.saveStrategyRecord({ ...fiche, actif });
  return { ok: true, id, actif, raison: `${actif ? 'activée' : 'désactivée'} — le sélecteur en tient compte` };
}

const activer = sujet => basculer(sujet, true);
const desactiver = sujet => basculer(sujet, false);

async function supprimer(sujet) {
  const id = idDe(sujet);
  if (!id) return { erreur: 'quelle stratégie ?' };
  const toutes = await DB.listStrategies();
  const fiche = toutes.find(s => s.id === id);
  if (!fiche) return { erreur: `stratégie « ${id} » introuvable` };
  // Jamais de suppression silencieuse : on désactive et on le dit.
  await DB.saveStrategyRecord({ ...fiche, actif: false });
  return {
    ok: true, id, actif: false,
    raison: 'désactivée plutôt que supprimée : l’historique reste utilisable pour l’apprentissage. '
      + 'Suppression définitive : à faire depuis l’écran Stratégies.'
  };
}

module.exports = { lister, activer, desactiver, supprimer };
