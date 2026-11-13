/**
 * Chat CRUD — Commandes TRADES.
 * Verbes : MONTRE (lister), EXPLIQUE (un trade), MODIFIE (stop/TP), SUPPRIME.
 *
 * Défaut corrigé : ce module appelait `Trades.lister/get/modifier/supprimer`,
 * qui n'existent pas. `delivery/trades.js` n'exporte que des fonctions pures
 * (normalize, close, computeStats…) ; la persistance vit dans `core/db.js`.
 * Résultat mesuré : « montre les positions » répondait
 * « Trades.lister is not a function ». Les quatre commandes étaient mortes.
 */

const DB = require('../../core/db');
const Trades = require('../../delivery/trades');
const Narrateur = require('../../apprentissage/narrateur');

const sym = sujet => (sujet.match(/(EURUSD|GBPUSD|USDJPY|XAUUSD|BTCUSDT|R_\d+|ETHUSDT|CRASH\d+)/i) || [])[1];

/** L'identifiant d'un trade : « #trd_42 » ou « trade 42 ». */
const idDe = sujet => (sujet.match(/(?:#|trade\s+)([A-Za-z0-9_-]{1,40})/i) || [])[1] || null;

async function lister(sujet) {
  const limite = Number((sujet.match(/(\d+)\s*(?:derniers?|premiers?)/i) || [])[1]) || 10;
  const instrument = sym(sujet);
  let items = await DB.listTrades();
  if (instrument) items = items.filter(t => String(t.symbol || t.instrument || '').toLowerCase() === instrument.toLowerCase());
  items = items.slice().sort((a, b) => (b.at || b.ouvertAt || 0) - (a.at || a.ouvertAt || 0));
  return {
    items: items.slice(0, Math.min(100, limite)),
    total: items.length,
    filtre: instrument || 'tous'
  };
}

async function expliquer(sujet) {
  const id = idDe(sujet);
  if (!id) return { erreur: 'quel trade ?', raison: 'donne son identifiant, ex. « explique #trd_42 »' };
  const items = await DB.listTrades();
  const trade = items.find(t => String(t.id) === id || String(t.id).endsWith(id));
  if (!trade) return { erreur: `trade ${id} introuvable` };
  return { texte: await Narrateur.expliquerTrade(trade) };
}

async function modifier(sujet) {
  const m = sujet.match(/(stop|tp1|tp2)\s+(?:du\s+)?(?:trade\s+)?#?([A-Za-z0-9_-]{1,40})\s+(?:à|a|=)\s+([0-9.]+)/i);
  if (!m) return { erreur: 'syntaxe : « modifie le stop du trade #trd_42 à 2386 »' };
  const [, champ, id, brut] = m;
  const valeur = Number(brut);
  if (!Number.isFinite(valeur)) return { erreur: 'valeur invalide' };

  const items = await DB.listTrades();
  const trade = items.find(t => String(t.id) === id || String(t.id).endsWith(id));
  if (!trade) return { erreur: `trade ${id} introuvable` };

  const ancien = trade[champ.toLowerCase()];
  const maj = { ...trade, [champ.toLowerCase()]: valeur };
  // On repasse par normalize : un trade modifié doit rester un trade valide.
  const enregistre = await DB.saveTradeRecord({ ...maj, ...Trades.normalize(maj) });
  return { ok: true, id, ancien, nouveau: valeur, enregistre: !!enregistre, raison: `${champ} mis à jour` };
}

async function supprimer(sujet) {
  const id = idDe(sujet);
  if (!id) return { erreur: 'quel trade ?', raison: 'donne son identifiant' };
  const items = await DB.listTrades();
  const trade = items.find(t => String(t.id) === id || String(t.id).endsWith(id));
  if (!trade) return { erreur: `trade ${id} introuvable` };
  await DB.removeTradeRecord(trade.id);
  return { ok: true, id: trade.id, raison: 'trade supprimé du registre' };
}

module.exports = { lister, expliquer, modifier, supprimer };
