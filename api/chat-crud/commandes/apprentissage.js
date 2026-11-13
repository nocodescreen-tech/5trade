/**
 * Chat CRUD — Commandes APPRENTISSAGE.
 * Verbes : MONTRE (journaux), EXPLIQUE (post-mortem d'un trade).
 */

const Diff = require('../../apprentissage/diff-versionne');
const PostMortem = require('../../post-mortem/generateur');
const Narrateur = require('../../apprentissage/narrateur');

async function lister(sujet, ctx) {
  // Détecter la période demandée
  const joursMatch = sujet.match(/(\d+)\s*(?:jours?|j)/);
  const semaine = /semaine/i.test(sujet);
  const limit = semaine ? 7 : (joursMatch ? Number(joursMatch[1]) : 1);

  if (semaine || joursMatch) {
    const texte = await Narrateur.resumerPeriode(limit);
    return { texte };
  }

  // Par défaut : dernier journal
  return await dernierJournal(sujet, ctx);
}

async function dernierJournal(sujet, ctx) {
  const auj = new Date().toISOString().slice(0, 10);
  const hier = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  let contenu = await Diff.lireJournal(auj);
  if (!contenu) contenu = await Diff.lireJournal(hier);
  if (!contenu) {
    return { texte: `Pas encore de journal d'apprentissage (${auj}). La boucle tourne à 02:00 UTC.` };
  }
  return { markdown: contenu };
}

async function expliquer(sujet, ctx) {
  // "explique le post-mortem du trade #847"
  const m = sujet.match(/trade\s*#?(\d+)/i);
  if (!m) return { erreur: 'quel trade ?' };
  const id = m[1];
  // Cherche le post-mortem dans le trade
  const Trades = require('../../delivery/trades');
  const trade = await Trades.get(id).catch(() => null);
  if (!trade) return { erreur: `trade #${id} introuvable` };
  const pm = await PostMortem.generer(trade);
  return { markdown: pm.markdown };
}

module.exports = { lister, expliquer, dernierJournal };
