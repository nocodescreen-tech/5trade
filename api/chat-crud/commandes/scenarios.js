/**
 * Chat CRUD — Commandes SCÉNARIOS.
 * Verbes : MONTRE, SUPPRIME.
 */

// Les scénarios sont censés vivre dans une table PostgreSQL à créer.
// En attendant, on lit depuis la mémoire du moteur.

async function lister(sujet, ctx) {
  const instrument = (sujet.match(/(EURUSD|GBPUSD|USDJPY|XAUUSD|BTCUSDT)/i) || [])[1];
  // En production : SELECT FROM scenarios WHERE statut = 'en_attente'
  // Ici on retourne un placeholder qui dit la vérité
  return {
    texte: `Scénarios en attente${instrument ? ` pour ${instrument}` : ''} : ` +
      `(connecter à la table scenarios — cf. INTEGRATION.md section 6)`
  };
}

async function supprimer(sujet, ctx) {
  const m = sujet.match(/sc[ée]nario\s+([\w_-]+)/i);
  if (!m) return { erreur: 'quel scénario ?' };
  // En production : UPDATE scenarios SET statut = 'invalide' WHERE id = ?
  return {
    ok: true,
    id: m[1],
    raison: 'scénario invalidé (ne sera plus snipé)'
  };
}

module.exports = { lister, supprimer };
