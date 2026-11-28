const test = require('node:test');
const assert = require('node:assert/strict');
const DerivClient = require('../deriv/client');
const DB = require('../core/db');

test('Deriv refuses an empty token without network access', async () => {
  const result = await DerivClient.verifierEtAutoriser('1089', '');
  assert.equal(result.ok, false);
  assert.match(result.error, /manquant/i);
});

test('Deriv distinguishes authorization rejection from network failure', async () => {
  const connect = DerivClient._connectCluster;
  const ask = DerivClient._ask;
  let closed = false;
  try {
    DerivClient._connectCluster = async () => ({ close() { closed = true; } });
    DerivClient._ask = async () => { throw new Error('Invalid token'); };
    const denied = await DerivClient.verifierEtAutoriser('1089', 'FAUX_TOKEN_XYZ_123');
    assert.equal(denied.ok, false);
    assert.match(denied.error, /invalid|token/i);
    assert.equal(closed, true);
    DerivClient._connectCluster = async () => { throw new Error('Network unavailable'); };
    const unavailable = await DerivClient.verifierEtAutoriser('1089', 'FAUX_TOKEN_XYZ_123');
    assert.equal(unavailable.ok, false);
    assert.match(unavailable.error, /network unavailable/i);
  } finally {
    DerivClient._connectCluster = connect;
    DerivClient._ask = ask;
  }
});

test('Deriv masks stored tokens and disconnects without touching persistent accounts', async () => {
  const read = DB.kvLire;
  const write = DB.kvEcrire;
  const cached = DerivClient._cachedConfig;
  let config = null;
  try {
    DB.kvLire = async () => config;
    DB.kvEcrire = async (_key, value) => { config = value; };
    DerivClient._cachedConfig = null;
    assert.equal((await DerivClient.obtenirStatut()).connecte, false);
    config = { appId: '1089', apiToken: 'secretTokenDeTest123456789', account: { loginid: 'VRTC123456', isVirtual: true }, actif: true };
    const status = await DerivClient.obtenirStatut();
    assert.equal(status.connecte, true);
    assert.match(status.tokenMasque, /••••••••/);
    assert.ok(!JSON.stringify(status).includes(config.apiToken));
    await DerivClient.deconnecter();
    assert.equal((await DerivClient.obtenirStatut()).connecte, false);
  } finally {
    DB.kvLire = read;
    DB.kvEcrire = write;
    DerivClient._cachedConfig = cached;
  }
});

test('Deriv live authorization probe', { skip: process.env.DERIV_LIVE_TEST !== '1' }, async () => {
  const result = await DerivClient.verifierEtAutoriser(process.env.DERIV_APP_ID, 'FAUX_TOKEN_XYZ_123');
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid|token/i);
});
