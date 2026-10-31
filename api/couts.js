/**
 * 5trade — compteur de coûts IA + plafond mensuel.
 *
 * Chaque appel payant (DeepSeek texte, vision) est journalisé avec ses tokens
 * et son coût estimé. Quand le plafond mensuel est atteint, les appels sont
 * refusés AVANT de partir (erreur 429) au lieu de vider le solde.
 *
 * Stockage : data/couts.json (local, pas de migration).
 * Tarifs USD par million de tokens, approximatifs, modifiables par env.
 */
const fs = require('fs');
const path = require('path');

// Fichier surchargeable par l'environnement : les tests écrivent à part,
// jamais dans le vrai journal de coûts de l'utilisateur.
const FICHIER = process.env.COUTS_FICHIER || path.join(__dirname, '..', 'data', 'couts.json');
const MAX_LIGNES = 2000;

const TARIF_ENTREE_PM = Number(process.env.COUT_USD_ENTREE_PM || 0.27);
const TARIF_SORTIE_PM = Number(process.env.COUT_USD_SORTIE_PM || 1.10);

function moisCle(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Plafond mensuel en USD (0 = illimité). Défaut protecteur : 5 $. */
function plafondMensuel() {
  const v = Number(process.env.BUDGET_MENSUEL_USD);
  if (!Number.isFinite(v) || v < 0) return 5;
  return v;
}

/** Estimation grossière (caractères/4) quand l'API ne renvoie pas d'usage. */
function estimerTokens(texte) {
  if (texte === null || texte === undefined) return 0;
  const s = typeof texte === 'string' ? texte : JSON.stringify(texte);
  return Math.ceil(s.length / 4);
}

function estimerEntree(messages) {
  if (!Array.isArray(messages)) return estimerTokens(messages);
  return messages.reduce((a, m) => {
    const c = m && m.content !== undefined ? m.content : m;
    return a + estimerTokens(typeof c === 'string' ? c : JSON.stringify(c));
  }, 0);
}

function lire() {
  try {
    const j = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

function ecrire(liste) {
  try {
    fs.mkdirSync(path.dirname(FICHIER), { recursive: true });
    fs.writeFileSync(FICHIER, JSON.stringify(liste.slice(-MAX_LIGNES), null, 1));
  } catch { /* le comptage ne doit jamais casser une analyse */ }
}

function enregistrer({ route = 'ia', modele = '?', entree = 0, sortie = 0, gratuit = false } = {}) {
  // Un modèle gratuit (secours NVIDIA NIM) garde ses tokens visibles dans le
  // journal mais ne doit JAMAIS peser sur le budget : cout = 0.
  const cout = gratuit ? 0 : (Number(entree) / 1e6) * TARIF_ENTREE_PM
    + (Number(sortie) / 1e6) * TARIF_SORTIE_PM;
  const lignes = lire();
  const e = {
    t: Date.now(), mois: moisCle(), route, modele,
    entree: Number(entree) || 0, sortie: Number(sortie) || 0,
    cout: +cout.toFixed(6)
  };
  lignes.push(e);
  ecrire(lignes);
  return e;
}

function bilan(mois = moisCle()) {
  const lignes = lire().filter(l => (l.mois || moisCle(new Date(l.t))) === mois);
  const depense = lignes.reduce((a, l) => a + (Number(l.cout) || 0), 0);
  const plafond = plafondMensuel();
  const parRoute = {};
  for (const l of lignes) {
    parRoute[l.route] = +((parRoute[l.route] || 0) + (Number(l.cout) || 0)).toFixed(6);
  }
  return {
    mois,
    appels: lignes.length,
    depense: +depense.toFixed(4),
    plafond,
    reste: plafond === 0 ? null : +(plafond - depense).toFixed(4),
    parRoute
  };
}

/** Lève une erreur 429 si le plafond mensuel est atteint (0 = illimité). */
function verifierBudget() {
  const b = bilan();
  if (b.plafond > 0 && b.depense >= b.plafond) {
    const e = new Error(
      `Budget IA mensuel épuisé (${b.depense.toFixed(2)} $ / ${b.plafond} $). ` +
      `Augmente BUDGET_MENSUEL_USD ou attends le mois prochain. ` +
      `L'onglet Direct (moteur local) reste gratuit.`
    );
    e.status = 429;
    throw e;
  }
  return b;
}

module.exports = { enregistrer, bilan, verifierBudget, estimerEntree, estimerTokens, plafondMensuel, moisCle };
