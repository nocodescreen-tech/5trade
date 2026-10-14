/**
 * 5trade — gestion multi-comptes.
 *
 * Permet de gérer plusieurs comptes de trading simultanément.
 * Chaque compte a ses propres trades, son propre capital et ses propres paramètres.
 */

const DB = require('./db');

/**
 * Crée un nouveau compte.
 *
 * @param {object} params
 * @param {string} params.nom - Nom du compte
 * @param {number} params.capital - Capital initial
 * @param {string} params.devise - Devise du compte (défaut: 'USD')
 * @returns {object} Compte créé
 */
async function creerCompte({ nom, capital, devise = 'USD' }) {
  if (!nom) throw new Error('Le nom du compte est requis');
  if (!capital || capital <= 0) throw new Error('Le capital doit être positif');

  const comptes = await DB.loadComptes();
  const id = 'acc_' + Date.now().toString(36);

  const compte = {
    id,
    nom,
    capital,
    devise,
    createdAt: new Date().toISOString(),
    actif: true
  };

  comptes[id] = compte;
  await DB.saveComptes(comptes);

  return compte;
}

/**
 * Récupère tous les comptes.
 *
 * @returns {Promise<Array>}
 */
async function listerComptes() {
  const comptes = await DB.loadComptes();
  return Object.values(comptes);
}

/**
 * Récupère un compte par son ID.
 *
 * @param {string} id - ID du compte
 * @returns {Promise<object|null>}
 */
async function getCompte(id) {
  const comptes = await DB.loadComptes();
  return comptes[id] || null;
}

/**
 * Met à jour le capital d'un compte.
 *
 * @param {string} id - ID du compte
 * @param {number} nouveauCapital - Nouveau capital
 * @returns {Promise<object>}
 */
async function mettreAJourCapital(id, nouveauCapital) {
  const comptes = await DB.loadComptes();
  if (!comptes[id]) throw new Error('Compte introuvable');

  comptes[id].capital = nouveauCapital;
  comptes[id].updatedAt = new Date().toISOString();
  await DB.saveComptes(comptes);

  return comptes[id];
}

/**
 * Supprime un compte.
 *
 * @param {string} id - ID du compte
 * @returns {Promise<boolean>}
 */
async function supprimerCompte(id) {
  const comptes = await DB.loadComptes();
  if (!comptes[id]) throw new Error('Compte introuvable');

  delete comptes[id];
  await DB.saveComptes(comptes);
  return true;
}

/**
 * Calcule le PnL total d'un compte.
 *
 * @param {string} id - ID du compte
 * @returns {Promise<{ pnlTotal: number, nbTrades: number, winRate: number }>}
 */
async function pnlCompte(id) {
  const trades = await DB.listTrades();
  const tradesCompte = trades.filter(t => t.compteId === id && t.status === 'closed');

  const pnlTotal = tradesCompte.reduce((a, t) => a + (t.pnl || 0), 0);
  const wins = tradesCompte.filter(t => t.result === 'win').length;
  const winRate = tradesCompte.length ? (wins / tradesCompte.length) * 100 : 0;

  return {
    pnlTotal: +pnlTotal.toFixed(2),
    nbTrades: tradesCompte.length,
    winRate: +winRate.toFixed(1)
  };
}

module.exports = { creerCompte, listerComptes, getCompte, mettreAJourCapital, supprimerCompte, pnlCompte };
