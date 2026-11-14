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

/**
 * Les fiches réelles portent `id` = `man_…` / `srch_…` et un `title` lisible.
 * L'ancienne extraction ne connaissait que `strategy_…` puis « dernier mot du
 * sujet » : « active ca =OB 5 étoiles SMC : Entrée sur déséquilibre
 * institutionnel » cherchait donc une stratégie nommée « institutionnel ».
 */
const ID_PATTERN = /((?:strategy|man|srch)_[A-Za-z0-9_-]+)/i;
const norm = s => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/**
 * Résout une fiche : identifiant explicite, sinon titre (exact, puis inclusion
 * unique). Rend `null` si ambigu — deux titres qui se ressemblent ne doivent pas
 * être départagés au hasard.
 */
function resoudre(sujet, toutes) {
  const direct = (String(sujet || '').match(ID_PATTERN) || [])[1];
  if (direct) {
    const parId = toutes.find(s => s.id === direct);
    if (parId) return parId;
  }
  const cible = norm(sujet);
  if (!cible) return null;
  const exact = toutes.filter(s => norm(s.title) === cible || norm(s.id) === cible);
  if (exact.length === 1) return exact[0];
  const contenus = toutes.filter(s => {
    const t = norm(s.title);
    return t && (cible.includes(t) || t.includes(cible));
  });
  return contenus.length === 1 ? contenus[0] : null;
}

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
  const toutes = await DB.listStrategies();
  const fiche = resoudre(sujet, toutes);
  if (!fiche) {
    return {
      erreur: `stratégie introuvable pour « ${String(sujet).slice(0, 60)} »`,
      raison: 'donne son titre exact ou son identifiant (man_… / srch_…)',
      disponibles: toutes.slice(0, 10).map(s => s.title || s.id)
    };
  }
  const id = fiche.id;
  if ((fiche.actif !== false) === actif) {
    return { ok: true, id, titre: fiche.title, inchange: true, raison: `déjà ${actif ? 'active' : 'inactive'}` };
  }
  await DB.saveStrategyRecord({ ...fiche, actif });
  return { ok: true, id, titre: fiche.title, actif, raison: `${actif ? 'activée' : 'désactivée'} — le sélecteur en tient compte` };
}

const activer = sujet => basculer(sujet, true);
const desactiver = sujet => basculer(sujet, false);

async function supprimer(sujet) {
  const toutes = await DB.listStrategies();
  const fiche = resoudre(sujet, toutes);
  if (!fiche) return { erreur: `stratégie introuvable pour « ${String(sujet).slice(0, 60)} »` };
  const id = fiche.id;
  // Jamais de suppression silencieuse : on désactive et on le dit.
  await DB.saveStrategyRecord({ ...fiche, actif: false });
  return {
    ok: true, id, titre: fiche.title, actif: false,
    raison: 'désactivée plutôt que supprimée : l’historique reste utilisable pour l’apprentissage. '
      + 'Suppression définitive : à faire depuis l’écran Stratégies.'
  };
}

module.exports = { lister, activer, desactiver, supprimer, resoudre };
