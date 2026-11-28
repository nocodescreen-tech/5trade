'use strict';

// Deriv Options REST API (PAT). Read-only account discovery and balance.
// No OTP socket or order is requested. Deriv requires the trade scope for account listing.
const DB = require('../core/db');
const crypto = require('node:crypto');

// A dedicated key must live outside the database and its backups.
function encryptionKey(value = process.env.DERIV_TOKEN_ENCRYPTION_KEY) {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error('DERIV_TOKEN_ENCRYPTION_KEY doit contenir 64 caractères hexadécimaux.');
  }
  return Buffer.from(value, 'hex');
}
function sealToken(token, appId, accountId, key = encryptionKey()) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(['deriv-pat-v1', appId, accountId])));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: encrypted.toString('hex') };
}
function openToken(box, appId, accountId, key = encryptionKey()) {
  if (!box || box.version !== 1 || !/^[a-f0-9]{24}$/.test(box.iv || '') ||
      !/^[a-f0-9]{32}$/.test(box.tag || '') || !/^(?:[a-f0-9]{2}){1,4096}$/.test(box.ciphertext || '')) {
    throw new Error('Configuration chiffrée Deriv invalide.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'hex'));
  decipher.setAAD(Buffer.from(JSON.stringify(['deriv-pat-v1', appId, accountId])));
  decipher.setAuthTag(Buffer.from(box.tag, 'hex'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(box.ciphertext, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Impossible de déchiffrer le PAT Deriv. Vérifiez la clé ou reconnectez le compte.');
  }
}
const ACCOUNTS_URL = 'https://api.derivws.com/trading/v1/options/accounts';
const DEFAULT_APP_ID = '353nKCVSd1Td4BoDbtjvr';

async function verifyAccounts(appId, token, preferredId = null, fetchImpl = globalThis.fetch) {
  if (typeof appId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(appId.trim())) {
    return { ok: false, error: 'App ID Deriv PAT invalide ou manquant' };
  }
  if (typeof token !== 'string' || !token.trim() || /\s/.test(token.trim()) || token.length > 4096) {
    return { ok: false, error: 'Token API Deriv manquant ou invalide' };
  }
  try {
    const res = await fetchImpl(ACCOUNTS_URL, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token.trim(), 'Deriv-App-ID': appId.trim(), Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) {
      const messages = {
        400: 'App ID ou requête invalide. Utilisez une application PAT de la nouvelle API Deriv.',
        401: 'Authentification Deriv refusée : vérifiez le PAT, son expiration et son App ID.',
        403: 'Permission Deriv insuffisante : vérifiez la portée trade requise pour la lecture des comptes Options.',
        404: 'Aucun compte Options Deriv trouvé.',
        429: 'Limite de requêtes Deriv atteinte. Réessayez plus tard.'
      };
      return { ok: false, error: messages[res.status] || 'Service Deriv indisponible ou réponse HTTP inattendue.' };
    }
    const body = await res.json();
    if (!Array.isArray(body?.data)) return { ok: false, error: 'Format de réponse Deriv inattendu' };
    const active = body.data.filter(a => a && a.status === 'active' &&
      typeof a.account_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(a.account_id) &&
      ['demo', 'real'].includes(a.account_type) && typeof a.currency === 'string' &&
      /^[A-Z0-9]{2,12}$/.test(a.currency) && Number.isFinite(a.balance));
    const demos = active.filter(a => a.account_type === 'demo');
    // Never silently switch accounts on refresh. Prefer the single demo on
    // first connection; otherwise require an unambiguous account.
    const selected = preferredId
      ? active.find(a => a.account_id === preferredId)
      : demos.length === 1 ? demos[0] : active.length === 1 ? active[0] : null;
    if (!selected) return { ok: false, error: preferredId
      ? 'Compte Deriv précédemment associé absent ou inactif. Reconnectez le compte.'
      : active.length ? 'Plusieurs comptes Deriv possibles : sélection explicite nécessaire.' : 'Aucun compte Options actif valide.' };
    return { ok: true, account: {
      loginid: selected.account_id, balance: selected.balance, currency: selected.currency,
      isVirtual: selected.account_type === 'demo', typeCompte: selected.account_type === 'demo' ? 'Démo' : 'Réel',
      scopes: [], product: 'options', apiMode: 'pat-rest', executionEnabled: false
    } };
  } catch {
    // Do not forward provider bodies, headers, credentials or raw network errors.
    return { ok: false, error: 'Impossible de lire les comptes Deriv : réseau, délai ou réponse invalide.' };
  }
}

class DerivClient {
  async verifierEtAutoriser(appId, apiToken, preferredId = null) {
    return verifyAccounts(appId, apiToken, preferredId);
  }

  async enregistrer(appId, apiToken, accountId = null) {
    let key;
    try { key = encryptionKey(); }
    catch (e) { return { success: false, error: e.message }; }
    const test = await this.verifierEtAutoriser(appId, apiToken, accountId);
    if (!test.ok) return { success: false, error: test.error };
    const config = {
      appId: appId.trim(), account: test.account,
      tokenBox: sealToken(apiToken.trim(), appId.trim(), test.account.loginid, key),
      updatedAt: new Date().toISOString(), actif: true
    };
    await DB.kvEcrire('deriv_config', config);
    return {
      success: true, message: 'Compte Options Deriv associé en lecture seule.',
      account: test.account
    };
  }

  async lireConfig() {
    return DB.kvLire('deriv_config', null);
  }

  async obtenirStatut() {
    const cfg = await this.lireConfig();
    if (!cfg || !cfg.actif) {
      return { connecte: false, appId: DEFAULT_APP_ID, executionEnabled: false,
        message: 'Aucun compte Deriv associé. Entrez un PAT et un App ID de la nouvelle API.' };
    }
    if (cfg.account?.apiMode !== 'pat-rest' || !cfg.tokenBox || cfg.apiToken) {
      return { connecte: false, appId: cfg.appId, executionEnabled: false,
        verification: 'reconnect_required', message: 'Ancienne configuration non chiffrée : déconnectez puis reconnectez avec un nouveau PAT.' };
    }
    try { openToken(cfg.tokenBox, cfg.appId, cfg.account.loginid); }
    catch { return { connecte: false, appId: cfg.appId, executionEnabled: false,
      verification: 'key_error', message: 'Clé de chiffrement Deriv absente ou incorrecte.' }; }
    return {
      connecte: true, appId: cfg.appId, tokenMasque: '••••••••', updatedAt: cfg.updatedAt,
      account: cfg.account || null, executionEnabled: false,
      verification: 'last_success'
    };
  }

  async rafraichirSolde() {
    const cfg = await this.lireConfig();
    if (!cfg || !cfg.actif) throw new Error('Deriv non configuré');
    if (cfg.account?.apiMode !== 'pat-rest' || !cfg.account.loginid || !cfg.tokenBox || cfg.apiToken) {
      throw new Error('Ancienne configuration Deriv : reconnectez votre compte avec un PAT.');
    }
    const token = openToken(cfg.tokenBox, cfg.appId, cfg.account.loginid);
    const test = await this.verifierEtAutoriser(cfg.appId, token, cfg.account.loginid);
    if (!test.ok) throw new Error(test.error);
    // A balance read must not recreate a configuration that was disconnected
    // during the remote request.
    const current = await this.lireConfig();
    if (!current || !current.actif || current.appId !== cfg.appId ||
        JSON.stringify(current.tokenBox) !== JSON.stringify(cfg.tokenBox) || current.account?.loginid !== cfg.account.loginid) {
      throw new Error('Configuration Deriv modifiée pendant la lecture.');
    }
    // No persistence needed for a live read: avoid races with connect/disconnect.
    return test.account;
  }

  async executerTrade() {
    return { success: false, code: 'EXECUTION_DISABLED',
      error: 'Exécution Deriv suspendue en attente du moteur de risque et de la réconciliation.' };
  }

  async deconnecter() {
    await DB.kvEcrire('deriv_config', null);
    return { success: true, message: 'Compte Deriv déconnecté' };
  }
}

module.exports = new DerivClient();
module.exports.verifyAccounts = verifyAccounts;

module.exports.sealToken = sealToken;
module.exports.openToken = openToken;
module.exports.encryptionKey = encryptionKey;
