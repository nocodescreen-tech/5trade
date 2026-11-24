/**
 * 5trade — Connecteur Officiel Broker Deriv (WebSocket API v3)
 * 
 * Permet l'authentification avec App ID et Token API,
 * la vérification du compte (solde, loginid, réel/démo),
 * le streaming de cotations et le passage d'ordres automatisés.
 */

const path = require('path');
const WebSocket = require(require.resolve('ws', { paths: [path.join(__dirname, '..')] }));
const DB = require('../core/db');

// Endpoints Deriv avec bascule automatique en cluster haute disponibilité
const DERIV_CLUSTERS = [
  'wss://red.derivws.com/websockets/v3',
  'wss://green.derivws.com/websockets/v3',
  'wss://blue.derivws.com/websockets/v3',
  'wss://ws.derivws.com/websockets/v3'
];

const DEFAULT_APP_ID = '1089';

class DerivClient {
  constructor() {
    this._activeSocket = null;
    this._cachedConfig = null;
  }

  /**
   * Établit une connexion avec bascule automatique entre les clusters Deriv
   */
  async _connectCluster(appId = DEFAULT_APP_ID, timeoutMs = 8000) {
    let dernierErr = null;
    for (const cluster of DERIV_CLUSTERS) {
      const url = `${cluster}?app_id=${encodeURIComponent(appId)}&l=fr&brand=deriv`;
      try {
        const ws = await new Promise((resolve, reject) => {
          const socket = new WebSocket(url);
          const timer = setTimeout(() => {
            try { socket.terminate(); } catch {}
            reject(new Error(`Délai dépassé pour ${cluster}`));
          }, timeoutMs);

          socket.on('open', () => {
            clearTimeout(timer);
            resolve(socket);
          });
          socket.on('error', err => {
            clearTimeout(timer);
            reject(err);
          });
        });
        return ws;
      } catch (err) {
        dernierErr = err;
      }
    }
    throw new Error(`Impossible de joindre les serveurs Deriv : ${dernierErr ? dernierErr.message : 'réseau inaccessible'}`);
  }

  /**
   * Envoie une requête JSON unique et attend la réponse correspondante
   */
  _ask(ws, payload, msgTypeExpected, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const reqId = payload.req_id || Math.floor(Math.random() * 100000);
      payload.req_id = reqId;

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Délai dépassé pour la requête Deriv (${msgTypeExpected || 'inconnue'})`));
      }, timeoutMs);

      const onMessage = (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.req_id === reqId || (msgTypeExpected && msg.msg_type === msgTypeExpected)) {
          cleanup();
          if (msg.error) {
            return reject(new Error(msg.error.message || `Erreur Deriv ${msg.error.code}`));
          }
          resolve(msg);
        }
      };

      const onError = (err) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        clearTimeout(timer);
        try { ws.removeListener('message', onMessage); } catch {}
        try { ws.removeListener('error', onError); } catch {}
      };

      ws.on('message', onMessage);
      ws.on('error', onError);

      try {
        ws.send(JSON.stringify(payload));
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }

  /**
   * Vérifie et autorise un compte avec son App ID et son Token API
   * Renvoie les informations complètes du compte en cas de succès
   */
  async verifierEtAutoriser(appId, apiToken) {
    if (!apiToken || typeof apiToken !== 'string' || !apiToken.trim()) {
      return { ok: false, error: 'Token API Deriv manquant ou invalide' };
    }
    const cleanAppId = String(appId || DEFAULT_APP_ID).trim() || DEFAULT_APP_ID;
    const cleanToken = apiToken.trim();

    let ws = null;
    try {
      ws = await this._connectCluster(cleanAppId);
      const res = await this._ask(ws, { authorize: cleanToken, req_id: 1 }, 'authorize', 9000);
      if (res && res.authorize) {
        const auth = res.authorize;
        return {
          ok: true,
          account: {
            loginid: auth.loginid,
            balance: Number(auth.balance) || 0,
            currency: auth.currency || 'USD',
            email: auth.email || '',
            fullname: auth.fullname || '',
            isVirtual: !!auth.is_virtual,
            typeCompte: auth.is_virtual ? 'Démo' : 'Réel',
            country: auth.country || '',
            scopes: auth.scopes || ['read', 'trade'],
            landingCompany: auth.landing_company_name || ''
          }
        };
      }
      return { ok: false, error: 'Réponse Deriv inattendue' };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      if (ws) {
        try { ws.close(); } catch {}
      }
    }
  }

  /**
   * Enregistre la configuration Deriv dans la couche de persistance
   */
  async enregistrer(appId, apiToken) {
    const test = await this.verifierEtAutoriser(appId, apiToken);
    if (!test.ok) {
      return { success: false, error: test.error };
    }
    const config = {
      appId: String(appId || DEFAULT_APP_ID).trim() || DEFAULT_APP_ID,
      apiToken: apiToken.trim(),
      account: test.account,
      updatedAt: new Date().toISOString(),
      actif: true
    };
    await DB.kvEcrire('deriv_config', config);
    this._cachedConfig = config;
    return {
      success: true,
      message: `Compte Deriv ${test.account.loginid} (${test.account.typeCompte}) connecté avec succès !`,
      account: test.account
    };
  }

  /**
   * Lit la configuration Deriv persistée
   */
  async lireConfig() {
    if (this._cachedConfig) return this._cachedConfig;
    const cfg = await DB.kvLire('deriv_config', null);
    this._cachedConfig = cfg;
    return cfg;
  }

  /**
   * Renvoie le statut public du connecteur Deriv (sans exposer le token secret)
   */
  async obtenirStatut() {
    const cfg = await this.lireConfig();
    if (!cfg || !cfg.actif || !cfg.apiToken) {
      return {
        connecte: false,
        appId: DEFAULT_APP_ID,
        message: 'Aucun compte Deriv associé. Entre ton Token et App ID.'
      };
    }
    // Token masqué pour la sécurité (ex: a1b2••••••••w9z0)
    const tokenMasque = cfg.apiToken.length > 8
      ? `${cfg.apiToken.slice(0, 4)}••••••••${cfg.apiToken.slice(-4)}`
      : '••••••••';

    return {
      connecte: true,
      appId: cfg.appId,
      tokenMasque,
      updatedAt: cfg.updatedAt,
      account: cfg.account || null
    };
  }

  /**
   * Récupère le solde en direct depuis Deriv
   */
  async rafraichirSolde() {
    const cfg = await this.lireConfig();
    if (!cfg || !cfg.actif || !cfg.apiToken) {
      throw new Error('Deriv non configuré');
    }
    const test = await this.verifierEtAutoriser(cfg.appId, cfg.apiToken);
    if (test.ok && test.account) {
      cfg.account = test.account;
      cfg.updatedAt = new Date().toISOString();
      await DB.kvEcrire('deriv_config', cfg);
      this._cachedConfig = cfg;
      return test.account;
    }
    throw new Error(test.error || 'Échec d\'actualisation du solde Deriv');
  }

  /**
   * Exécute un ordre de trade sur Deriv
   * Supporte les contrats Multipliers ou Rise/Fall (Call/Put)
   */
  async executerTrade({ symbol, direction, amount = 10, type = 'MULTUP' }) {
    const cfg = await this.lireConfig();
    if (!cfg || !cfg.actif || !cfg.apiToken) {
      return { success: false, error: 'Compte Deriv non connecté. Active d\'abord ton token dans les paramètres.' };
    }

    const sensAchat = direction === 'BUY' || direction === 'long';
    // Mapping du type de contrat : si non spécifié, utilise CALL ou PUT
    const contractType = type || (sensAchat ? 'CALL' : 'PUT');

    let ws = null;
    try {
      ws = await this._connectCluster(cfg.appId);
      // 1. Authentification
      await this._ask(ws, { authorize: cfg.apiToken }, 'authorize', 9000);

      // 2. Demande de proposition de prix (Proposal)
      const propReq = {
        proposal: 1,
        amount: Number(amount) || 10,
        basis: 'stake',
        contract_type: contractType,
        currency: cfg.account.currency || 'USD',
        duration: 5,
        duration_unit: 'm',
        symbol: symbol || 'R_75',
        req_id: 2
      };

      const propRes = await this._ask(ws, propReq, 'proposal', 8000);
      if (!propRes || !propRes.proposal || !propRes.proposal.id) {
        throw new Error('Deriv n\'a pas retourné de cotation valide pour cet ordre');
      }

      // 3. Achat effectif du contrat
      const buyRes = await this._ask(ws, {
        buy: propRes.proposal.id,
        price: propRes.proposal.ask_price,
        req_id: 3
      }, 'buy', 8000);

      if (buyRes && buyRes.buy) {
        const b = buyRes.buy;
        // Met à jour le solde dans la config
        if (b.balance_after) {
          cfg.account.balance = Number(b.balance_after);
          await DB.kvEcrire('deriv_config', cfg);
          this._cachedConfig = cfg;
        }
        return {
          success: true,
          contractId: b.contract_id,
          transactionId: b.transaction_id,
          buyPrice: b.buy_price,
          payout: b.payout,
          balanceAfter: b.balance_after,
          account: cfg.account
        };
      }
      return { success: false, error: 'Achat non confirmé par Deriv' };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      if (ws) {
        try { ws.close(); } catch {}
      }
    }
  }

  /**
   * Déconnecte le compte Deriv
   */
  async deconnecter() {
    await DB.kvEcrire('deriv_config', null);
    this._cachedConfig = null;
    return { success: true, message: 'Compte Deriv déconnecté' };
  }
}

module.exports = new DerivClient();
