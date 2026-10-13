/**
 * Appels réseau avec reprise.
 *
 * POURQUOI CE MODULE
 * Mesure réelle : une requête vers Telegram met 8,7 secondes à aboutir depuis
 * cette connexion. Les délais par défaut de fetch coupent parfois avant la
 * réponse, et l'appel échoue avec un « fetch failed » alors qu'il était valide —
 * le message Telegram partait donc une fois sur deux.
 *
 * Plutôt que d'imposer une dépendance supplémentaire, on reprend l'appel
 * quelques fois, avec un délai généreux. Une erreur réseau passagère ne doit pas
 * faire perdre une alerte.
 */

/** Délai maximal d'un essai (large : le réseau est lent, pas cassé). */
const DELAI_MS = 45000;

/**
 * fetch qui réessaie en cas d'échec réseau.
 *
 * @param {string} url
 * @param {object} options  options de fetch (method, headers, body…)
 * @param {number} essais   nombre total de tentatives (3 par défaut)
 * @returns {Promise<Response>} la réponse HTTP (même si elle est en erreur : un
 *   404 ou un 400 est une réponse, et c'est à l'appelant de la juger)
 */
async function fetchAvecReprise(url, options = {}, essais = 3) {
  let derniere = null;
  for (let i = 1; i <= essais; i++) {
    try {
      const r = await fetch(url, { ...options, signal: AbortSignal.timeout(DELAI_MS) });
      // Une réponse HTTP, même en erreur, est un succès réseau : on la rend.
      return r;
    } catch (e) {
      derniere = e;
      if (i < essais) {
        // On laisse respirer le réseau avant de réessayer.
        await new Promise(r => setTimeout(r, 700 * i));
      }
    }
  }
  const cause = derniere && derniere.cause && derniere.cause.message;
  throw new Error(`Réseau injoignable après ${essais} tentatives : ${derniere ? derniere.message : '?'}`
    + (cause ? ` (${cause})` : ''));
}

module.exports = { fetchAvecReprise, DELAI_MS };
