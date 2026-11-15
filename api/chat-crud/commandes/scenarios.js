/**
 * Chat CRUD — Commandes SCÉNARIOS.
 * Verbes : MONTRE (lister), SUPPRIME (invalider).
 *
 * Corrigé : cette commande répondait « connecter à la table scenarios ». La
 * table existe maintenant (`api/scenarios/registre.js`), elle est lue ici pour
 * de vrai, et une invalidation ÉCRIT le statut au lieu de le prétendre.
 */

const Scenarios = require('../../scenarios');

const STATUTS = {
  attente: 'en_attente', attente_: 'en_attente',
  declenche: 'declenche', declenches: 'declenche',
  expire: 'expire', expires: 'expire',
  invalide: 'invalide', invalides: 'invalide',
  execute: 'execute'
};

async function lister(sujet) {
  const instrument = (sujet.match(/(EURUSD|GBPUSD|USDJPY|XAUUSD|BTCUSDT|R_\d+|ETHUSDT|CRASH\d+)/i) || [])[1];
  const motStatut = (sujet.match(/(en\s*attente|d[ée]clench[ée]s?|expir[ée]s?|invalid[ée]s?|ex[ée]cut[ée]s?)/i) || [])[1];
  const statut = motStatut
    ? (STATUTS[motStatut.toLowerCase().replace(/\s+/g, '')] || 'en_attente')
    : 'en_attente';

  await Scenarios.expirer();
  const items = await Scenarios.lister({
    statut,
    instrument: instrument ? instrument.toUpperCase() : null,
    limite: 20
  });

  if (!items.length) {
    return {
      items: [],
      texte: `Aucun scénario ${statut.replace('_', ' ')}${instrument ? ` sur ${instrument}` : ''}. `
        + 'Un scénario est un plan d’attente : il n’existe que si une zone réelle et un ATR sont mesurables.'
    };
  }
  return { items, total: items.length, statut };
}

async function supprimer(sujet) {
  const id = (sujet.match(/(scn_[A-Za-z0-9_]+)/) || [])[1]
    || (sujet.match(/sc[ée]nario\s+([\w-]+)/i) || [])[1];
  if (!id) return { erreur: 'quel scénario ?', raison: 'donne son identifiant (scn_…)' };
  const r = await Scenarios.changerStatut(id, 'invalide', 'invalidé depuis le chat');
  if (!r.ok) return { erreur: `scénario ${id} introuvable` };
  return { ok: true, id, raison: 'scénario invalidé : il ne sera plus déclenché' };
}

module.exports = { lister, supprimer };
