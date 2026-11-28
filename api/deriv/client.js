/**
 * 5trade — Connecteur Deriv (REST PAT + WebSocket OTP)
 * 
 * Permet l'authentification avec App ID et Token API,
 * la vérification du compte (solde, loginid, réel/démo),
 * sans passage d'ordres pendant la migration.
 */

const path = require('path');
const WebSocket = require(require.resolve('ws', { paths: [path.join(__dirname, '..')] }));
const DB = require('../core/db');
const crypto = require('node:crypto');

function encryptionKey() {
  const raw = process.env.DERIV_TOKEN_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(raw)) throw new Error('DERIV_TOKEN_KEY absent ou invalide : configurez une clé hexadécimale de 32 octets côté serveur');
  return Buffer.from(raw, 'hex');
}
function protectConfig(cfg) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from('5trade:deriv:v1'));
  const encrypted = Buffer.concat([cipher.update(cfg.apiToken, 'utf8'), cipher.final()]);
  const { apiToken, ...publicFields } = cfg;
  return { ...publicFields, tokenEncrypted: { v: 1, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: encrypted.toString('hex') } };
}
function unprotectConfig(cfg) {
  if (!cfg?.tokenEncrypted) return cfg;
  const t = cfg.tokenEncrypted;
  try {
    if (t.v !== 1) throw new Error('version');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(t.iv, 'hex'));
    decipher.setAAD(Buffer.from('5trade:deriv:v1'));
    decipher.setAuthTag(Buffer.from(t.tag, 'hex'));
    const apiToken = Buffer.concat([decipher.update(Buffer.from(t.data, 'hex')), decipher.final()]).toString('utf8');
    const { tokenEncrypted, ...fields } = cfg;
    return { ...fields, apiToken };
  } catch {
    throw new Error('Deriv : token illisible ou clé de chiffrement incorrecte. Vérifiez DERIV_TOKEN_KEY.');
  }
}


const DEFAULT_APP_ID = process.env.DERIV_APP_ID || '';
const BASE = 'https://api.derivws.com';
const ACCOUNTS = '/trading/v1/options/accounts';

class DerivClient {
  constructor() {
    this._cachedConfig = null;
  }

  async _rest(appId, token, endpoint, method = 'GET') {
    let response;
    try {
      response = await fetch(BASE + endpoint, {
        method, redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: { Authorization: 'Bearer ' + token, 'Deriv-App-ID': appId, Accept: 'application/json' }
      });
    } catch {
      throw new Error('Deriv : réseau REST indisponible ou délai dépassé');
    }
    if (!response.ok) {
      const reasons = { 401: 'PAT ou App ID invalide', 403: 'permission trade manquante ou accès refusé', 429: 'limite de requêtes atteinte', 404: 'compte Options introuvable' };
      throw new Error('Deriv HTTP ' + response.status + ' : ' + (reasons[response.status] || 'service indisponible ou requête refusée'));
    }
    try { return await response.json(); }
    catch { throw new Error('Deriv : réponse REST non JSON'); }
  }

  async _connectCluster(url, timeoutMs = 10000) {
    const target = new URL(url);
    if (target.protocol !== 'wss:' || target.host !== 'api.derivws.com' ||
        !['/trading/v1/options/ws/demo', '/trading/v1/options/ws/real'].includes(target.pathname) ||
        !target.searchParams.get('otp') || target.username || target.password) {
      throw new Error('Deriv : URL OTP invalide');
    }
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(target.toString(), { handshakeTimeout: timeoutMs });
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('Deriv : délai WebSocket dépassé')); }, timeoutMs);
      // Ne jamais propager une erreur susceptible de contenir l'URL OTP.
      ws.on('error', () => { clearTimeout(timer); reject(new Error('Deriv : connexion WebSocket impossible')); });
      ws.once('open', () => { clearTimeout(timer); resolve(ws); });
      ws.once('close', () => { clearTimeout(timer); reject(new Error('Deriv : WebSocket fermé')); });
    });
  }

  async _openAccount(appId, token, account) {
    const result = await this._rest(appId, token, ACCOUNTS + '/' + encodeURIComponent(account.loginid) + '/otp', 'POST');
    const url = result?.data?.url;
    if (typeof url !== 'string') throw new Error('Deriv : URL OTP absente');
    const expected = '/trading/v1/options/ws/' + (account.isVirtual ? 'demo' : 'real');
    if (new URL(url).pathname !== expected) throw new Error('Deriv : type de compte OTP incohérent');
    return this._connectCluster(url);
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
        if (msg.req_id === reqId) {
          cleanup();
          if (msg.error) {
            return reject(new Error(msg.error.message || `Erreur Deriv ${msg.error.code}`));
          }
          if (msgTypeExpected && msg.msg_type !== msgTypeExpected) return reject(new Error('Deriv : réponse inattendue'));
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
  async verifierEtAutoriser(appId, apiToken, accountId = null) {
    if (typeof apiToken !== 'string' || !apiToken.trim()) return { ok: false, error: 'Token API Deriv manquant' };
    const id = String(appId || DEFAULT_APP_ID).trim();
    if (!id) return { ok: false, error: 'App ID Deriv manquant' };
    let ws;
    try {
      const result = await this._rest(id, apiToken.trim(), ACCOUNTS);
      if (!Array.isArray(result?.data)) throw new Error('Deriv : liste de comptes inattendue');
      const accounts = result.data.filter(a => a && typeof a.account_id === 'string' &&
        ['demo', 'real'].includes(a.account_type) && a.status === 'active').map(a => ({
          loginid: a.account_id, currency: a.currency, isVirtual: a.account_type === 'demo',
          typeCompte: a.account_type === 'demo' ? 'Démo' : 'Réel'
        }));
      const account = accountId ? accounts.find(a => a.loginid === accountId) : accounts.find(a => a.isVirtual);
      if (!account) return { ok: false, error: 'Deriv : aucun compte démo actif ou compte sélectionné introuvable', accounts };
      ws = await this._openAccount(id, apiToken.trim(), account);
      const res = await this._ask(ws, { balance: 1, req_id: 1 }, 'balance');
      const balance = res?.balance?.balance;
      if (balance == null || balance === '' || !Number.isFinite(Number(balance))) throw new Error('Deriv : solde absent ou invalide');
      if (res.balance.loginid && res.balance.loginid !== account.loginid) throw new Error('Deriv : compte retourné incohérent');
      return { ok: true, account: { ...account, balance: Number(balance), currency: res.balance.currency || account.currency }, accounts };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      if (ws) try { ws.close(); } catch {}
    }
  }

  /**
   * Enregistre la configuration Deriv dans la couche de persistance
   */
  async enregistrer(appId, apiToken, accountId = null) {
    try { encryptionKey(); } catch (err) { return { success: false, error: err.message }; }
    const test = await this.verifierEtAutoriser(appId, apiToken, accountId);
    if (!test.ok) {
      return { success: false, error: test.error, accounts: test.accounts || [] };
    }
    const config = {
      appId: String(appId || DEFAULT_APP_ID).trim() || DEFAULT_APP_ID,
      apiToken: apiToken.trim(),
      account: test.account,
      updatedAt: new Date().toISOString(),
      actif: true
    };
    await DB.kvEcrire('deriv_config', protectConfig(config));
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
    const stored = await DB.kvLire('deriv_config', null);
    const cfg = unprotectConfig(stored);
    if (cfg?.apiToken && !stored.tokenEncrypted) {
      await DB.kvEcrire('deriv_config', protectConfig(cfg));
    }
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
    const tokenMasque = '••••••••';

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
    const test = await this.verifierEtAutoriser(cfg.appId, cfg.apiToken, cfg.account?.loginid);
    if (test.ok && test.account) {
      cfg.account = test.account;
      cfg.updatedAt = new Date().toISOString();
      await DB.kvEcrire('deriv_config', protectConfig(cfg));
      this._cachedConfig = cfg;
      return test.account;
    }
    throw new Error(test.error || 'Échec d\'actualisation du solde Deriv');
  }

  /**
   * Exécute un ordre de trade sur Deriv
   * Supporte les contrats Multipliers ou Rise/Fall (Call/Put)
   */
  async executerTrade() {
    // La connexion et le solde sont migrés; les ordres doivent attendre
    // la validation du nouveau contrat de trading et du contrôle de risque.
    return { success: false, error: 'Exécution Deriv suspendue pendant la migration API OTP' };
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
