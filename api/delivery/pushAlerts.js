/**
 * 5trade — alertes push (notifications navigateur).
 *
 * Envoie des notifications push via l'API Web Push (VAPID).
 * Nécessite un service worker côté client.
 */

const webpush = require('web-push');

let vapidKeys = null;

/**
 * Configure les clés VAPID.
 * @param {string} publicKey - Clé publique VAPID
 * @param {string} privateKey - Clé privée VAPID
 */
function configurerVAPID(publicKey, privateKey) {
  vapidKeys = { publicKey, privateKey };
  webpush.setVapidDetails(
    'mailto:admin@5trade.com',
    publicKey,
    privateKey
  );
}

/**
 * Envoie une notification push à un abonné.
 *
 * @param {object} subscription - Abonnement push { endpoint, keys: { p256dh, auth } }
 * @param {object} payload - Données de la notification
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function envoyerNotification(subscription, payload) {
  if (!vapidKeys) {
    return { success: false, error: 'VAPID non configuré' };
  }

  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return { success: true };
  } catch (e) {
    // 410 Gone / 404 : l'abonnement n'existe plus côté navigateur.
    // L'appelant doit purger, pas réessayer.
    const expire = e && (e.statusCode === 410 || e.statusCode === 404);
    return { success: false, expired: !!expire, error: e.message };
  }
}

/** Le module peut-il envoyer (clés VAPID posées) ? */
function vapidPret() {
  return !!vapidKeys;
}

/**
 * Crée le payload d'une notification de signal.
 *
 * @param {object} signal - Signal détecté
 * @returns {object} Payload de la notification
 */
function payloadSignal(signal) {
  return {
    title: `5trade — ${signal.direction === 'BUY' ? 'ACHAT' : 'VENTE'} ${signal.status}`,
    body: `${signal.symbol} · force ${(signal.strength * 100).toFixed(0)} % · entrée ${signal.levels?.entry || '—'}`,
    icon: '/logo.svg',
    badge: '/logo.svg',
    data: {
      url: '/?tab=live',
      signalId: signal.id
    }
  };
}

/**
 * Crée le payload d'une notification de trade.
 *
 * @param {object} trade - Trade clôturé
 * @returns {object} Payload de la notification
 */
function payloadTrade(trade) {
  const pnl = trade.pnl || 0;
  const emoji = pnl > 0 ? '✅' : pnl < 0 ? '❌' : '➖';

  return {
    title: `5trade — Trade ${trade.result}`,
    body: `${emoji} ${trade.pair} ${trade.direction} · PnL ${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}`,
    icon: '/logo.svg',
    badge: '/logo.svg',
    data: {
      url: '/?tab=trades',
      tradeId: trade.id
    }
  };
}

module.exports = { configurerVAPID, vapidPret, envoyerNotification, payloadSignal, payloadTrade };
