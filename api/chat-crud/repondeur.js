/**
 * 5trade — Chat CRUD : répondeur.
 *
 * Formate la sortie de chaque commande en langage naturel lisible.
 * Le répondeur ne fait rien d'autre : il transforme un objet structuré
 * en texte que l'utilisateur lira dans le chat.
 */

/**
 * @param {object} resultat  résultat de l'exécution
 * @param {object} action    action initiale { verbe, sujet }
 * @returns {string}
 */
function formater(resultat, action) {
  if (!resultat) return 'Commande exécutée.';

  // Erreur
  if (resultat.erreur) {
    return `Erreur : ${resultat.erreur}${resultat.raison ? ` (${resultat.raison})` : ''}`;
  }

  // Confirmation requise
  if (resultat.confirmation_requise) {
    const lignes = ['Confirmation requise :'];
    if (resultat.raison) lignes.push(`- ${resultat.raison}`);
    if (resultat.detail) lignes.push(`- Détail : ${JSON.stringify(resultat.detail)}`);
    lignes.push('Confirmer ? (oui/non)');
    return lignes.join('\n');
  }

  // Rejeté
  if (resultat.statut === 'rejete' || resultat.statut === 'gele') {
    return `Action ${resultat.statut} : ${resultat.raison || 'raison non précisée'}`;
  }

  // Listes
  if (Array.isArray(resultat.items)) {
    if (!resultat.items.length) return `Aucun élément trouvé pour « ${action.sujet} ».`;
    const lignes = [`${resultat.items.length} élément(s) pour « ${action.sujet} » :`];
    for (const it of resultat.items.slice(0, 20)) {
      lignes.push(`  - ${formaterItem(it)}`);
    }
    if (resultat.items.length > 20) {
      lignes.push(`  ... et ${resultat.items.length - 20} autre(s).`);
    }
    return lignes.join('\n');
  }

  // Texte direct (narrateur, journal, post-mortem)
  if (typeof resultat.texte === 'string') return resultat.texte;
  if (typeof resultat.markdown === 'string') return resultat.markdown;

  // OK simple
  if (resultat.ok) {
    const parties = ['Action exécutée.'];
    if (resultat.id) parties.push(`ID : ${resultat.id}`);
    if (resultat.ancien !== undefined && resultat.nouveau !== undefined) {
      parties.push(`${resultat.parametre || 'valeur'} : ${resultat.ancien} → ${resultat.nouveau}`);
    }
    if (resultat.raison) parties.push(resultat.raison);
    if (resultat.version) parties.push(`Version : ${resultat.version}`);
    if (resultat.applicable_en) {
      parties.push(`Promotion dans ${Math.round(resultat.applicable_en / 3600000)}h (shadow run)`);
    }
    return parties.join('\n');
  }

  // Objet non structuré : JSON
  return '```\n' + JSON.stringify(resultat, null, 2).slice(0, 800) + '\n```';
}

function formaterItem(it) {
  if (typeof it === 'string') return it;
  if (it.titre) return `${it.titre}${it.id ? ` (${it.id})` : ''}`;
  if (it.instrument) {
    return `${it.instrument} ${it.direction || ''} ${it.entree_prix || ''} → ${it.issue || '?'} (${it.r_realise || '?'}R)`;
  }
  if (it.description) return `${it.description} (confiance ${it.confiance || '?'})`;
  return JSON.stringify(it).slice(0, 100);
}

/**
 * Message d'aide par défaut.
 */
function aide() {
  return [
    'Commandes disponibles :',
    '',
    'Lecture :',
    '  montre les trades / les stratégies / les scénarios en attente',
    '  montre l\'état du système',
    '  qu\'est-ce que tu sais sur XAUUSD ?',
    '  qu\'est-ce que tu as appris cette semaine ?',
    '  pourquoi tu as pris ce trade #847 ?',
    '',
    'Création :',
    '  crée une exception : ne pas trader EURUSD vendredi après 16h',
    '  crée une stratégie retour POC',
    '',
    'Modification :',
    '  modifie le stop ATR à 1.2 sur XAUUSD',
    '  ajuste le RSI d\'entrée à 38',
    '',
    'Activation :',
    '  active la stratégie momentum',
    '  désactive les trades Asia',
    '',
    'Suppression :',
    '  supprime la stratégie momentum',
    '  retire l\'exception exc_eurusd_fri_close',
    '',
    'Apprentissage :',
    '  apprends : hier trade #847 était mauvais, tu as ignoré la divergence RSI',
    '  non : ce signal n\'était pas valide',
  ].join('\n');
}

module.exports = { formater, aide };
