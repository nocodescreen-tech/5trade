/**
 * 5TRADE — Traçabilité & Envoi Fiabilisé des Notifications Telegram
 *
 * Évite les envois multiples, garantit la persistance des marqueurs d'envoi
 * même après redémarrage du serveur, et vérifie explicitement l'accusé de réception
 * HTTP et JSON renvoyé par l'API Telegram avec reprise sur incident réseau.
 */

const fs = require('fs');
const path = require('path');
const { fetchAvecReprise } = require('../core/reseau');
const { DATA_DIR } = require('../core/dossiers');

const FICHIER_TRACKER = path.join(DATA_DIR, 'notifications-journal.json');

function lireJournal() {
  try {
    if (fs.existsSync(FICHIER_TRACKER)) {
      return JSON.parse(fs.readFileSync(FICHIER_TRACKER, 'utf8'));
    }
  } catch {}
  return {};
}

function ecrireJournal(journal) {
  try {
    fs.mkdirSync(path.dirname(FICHIER_TRACKER), { recursive: true });
    fs.writeFileSync(FICHIER_TRACKER, JSON.stringify(journal, null, 2), 'utf8');
  } catch {}
}

/**
 * Vérifie si une alerte portant cette clé a déjà été transmise avec succès.
 * @param {string} cle
 * @returns {boolean}
 */
function estDejaEnvoye(cle) {
  const journal = lireJournal();
  return !!(journal[cle] && journal[cle].succes === true);
}

/**
 * Enregistre le statut d'une transmission dans le journal persistant.
 * @param {string} cle
 * @param {object} metadata
 */
function marquerEnvoye(cle, metadata = {}) {
  const journal = lireJournal();
  journal[cle] = {
    at: new Date().toISOString(),
    succes: true,
    ...metadata
  };
  ecrireJournal(journal);
}

/**
 * Envoie un message Telegram avec vérification stricte du code retour HTTP et du payload.
 * Reprise automatique sur latence réseau.
 * @param {string} token
 * @param {string|number} chatId
 * @param {string} texte
 * @param {object} [opts={}]
 * @returns {Promise<{ok: boolean, messageId?: number, erreur?: string}>}
 */
async function envoyerTelegramSecurise(token, chatId, texte, opts = {}) {
  if (!token || !chatId) {
    return { ok: false, erreur: 'Token bot Telegram ou Chat ID manquant' };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const corps = {
    chat_id: chatId,
    text: texte,
    parse_mode: opts.parse_mode || 'HTML'
  };
  if (opts.reply_markup) corps.reply_markup = opts.reply_markup;

  try {
    const res = await fetchAvecReprise(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps)
    }, 3);

    const texteBrut = await res.text();
    let data = {};
    try { data = JSON.parse(texteBrut); } catch {}

    if (!res.ok || data.ok !== true) {
      const motif = data.description || `HTTP ${res.status} ${texteBrut.slice(0, 100)}`;
      console.error(`[Telegram] Rejet d'envoi : ${motif}`);
      return { ok: false, erreur: motif };
    }

    return {
      ok: true,
      messageId: data.result ? data.result.message_id : null
    };
  } catch (e) {
    console.error(`[Telegram] Échec réseau définitif : ${e.message}`);
    return { ok: false, erreur: e.message };
  }
}

module.exports = {
  estDejaEnvoye,
  marquerEnvoye,
  envoyerTelegramSecurise
};
