const test = require('node:test');
const assert = require('node:assert/strict');
const DerivClient = require('../deriv/client');
const DB = require('../core/db');

test('Deriv refuses an empty token without network access', async () => {
  const result = await DerivClient.verifierEtAutoriser('1089', '');
  assert.equal(result.ok, false);
  assert.match(result.error, /manquant/i);
});

test('Deriv REST authentication distinguishes rejection and network failure', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => ({ ok: false, status: 401 });
    const denied = await DerivClient.verifierEtAutoriser('app', 'test-token');
    assert.equal(denied.ok, false);
    assert.match(denied.error, /401/);
    global.fetch = async () => { throw new Error('Network unavailable'); };
    const unavailable = await DerivClient.verifierEtAutoriser('app', 'test-token');
    assert.equal(unavailable.ok, false);
    assert.match(unavailable.error, /réseau REST/);
  } finally { global.fetch = original; }
});

test('PAT and OTP flow selects demo, validates headers and reads actual balance', async () => {
  const original = global.fetch;
  const connect = DerivClient._connectCluster;
  const ask = DerivClient._ask;
  const calls = [];
  let closed = false;
  try {
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      const data = calls.length === 1 ? [
        { account_id: 'REAL1', account_type: 'real', status: 'active', currency: 'USD' },
        { account_id: 'DEMO1', account_type: 'demo', status: 'active', currency: 'USD' }
      ] : { url: 'wss://api.derivws.com/trading/v1/options/ws/demo?otp=test' };
      return { ok: true, json: async () => ({ data }) };
    };
    DerivClient._connectCluster = async url => {
      assert.match(url, /ws\/demo\?otp=/);
      return { close() { closed = true; } };
    };
    DerivClient._ask = async (_ws, payload, kind) => {
      assert.equal(payload.balance, 1);
      assert.equal(kind, 'balance');
      return { balance: { balance: '125.50', currency: 'USD' } };
    };
    const result = await DerivClient.verifierEtAutoriser('app', 'test-token');
    assert.equal(result.ok, true);
    assert.equal(result.account.loginid, 'DEMO1');
    assert.equal(result.account.balance, 125.5);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
    assert.equal(calls[0].options.headers['Deriv-App-ID'], 'app');
    assert.match(calls[1].url, /DEMO1\/otp$/);
    assert.equal(calls[1].options.method, 'POST');
    assert.equal(closed, true);
  } finally {
    global.fetch = original;
    DerivClient._connectCluster = connect;
    DerivClient._ask = ask;
  }
});

test('real account is never automatically selected', async () => {
  const rest = DerivClient._rest;
  try {
    DerivClient._rest = async () => ({ data: [{ account_id: 'REAL1', account_type: 'real', status: 'active' }] });
    const result = await DerivClient.verifierEtAutoriser('app', 'test-token');
    assert.equal(result.ok, false);
    assert.match(result.error, /démo/);
  } finally { DerivClient._rest = rest; }
});

test('Deriv masks stored tokens and disconnects without touching persistent accounts', async () => {
  const read = DB.kvLire;
  const write = DB.kvEcrire;
  const cached = DerivClient._cachedConfig;
  let config = null;
  const previousKey = process.env.DERIV_TOKEN_KEY;
  process.env.DERIV_TOKEN_KEY = 'ab'.repeat(32);
  try {
    DB.kvLire = async () => config;
    DB.kvEcrire = async (_key, value) => { config = value; };
    DerivClient._cachedConfig = null;
    assert.equal((await DerivClient.obtenirStatut()).connecte, false);
    config = { appId: '1089', apiToken: 'secretTokenDeTest123456789', account: { loginid: 'VRTC123456', isVirtual: true }, actif: true };
    const status = await DerivClient.obtenirStatut();
    assert.equal(status.connecte, true);
    assert.match(status.tokenMasque, /••••••••/);
    assert.equal(config.apiToken, undefined);
    assert.equal(config.tokenEncrypted.v, 1);
    assert.ok(!JSON.stringify(config).includes('secretTokenDeTest123456789'));
    assert.ok(!JSON.stringify(status).includes('secretTokenDeTest123456789'));
    DerivClient._cachedConfig = null;
    assert.equal((await DerivClient.lireConfig()).apiToken, 'secretTokenDeTest123456789');
    await DerivClient.deconnecter();
    assert.equal((await DerivClient.obtenirStatut()).connecte, false);
  } finally {
    DB.kvLire = read;
    DB.kvEcrire = write;
    DerivClient._cachedConfig = cached;
    if (previousKey === undefined) delete process.env.DERIV_TOKEN_KEY;
    else process.env.DERIV_TOKEN_KEY = previousKey;
  }
});

test('Deriv live authorization probe', { skip: process.env.DERIV_LIVE_TEST !== '1' }, async () => {
  const result = await DerivClient.verifierEtAutoriser(process.env.DERIV_APP_ID, 'FAUX_TOKEN_XYZ_123');
  assert.equal(result.ok, false);
  assert.match(result.error, /401|403/);
});


test('multiple active demo accounts require explicit selection', async () => {
  const rest = DerivClient._rest;
  try {
    DerivClient._rest = async () => ({ data: ['DEMO1','DEMO2'].map(account_id => ({account_id,account_type:'demo',status:'active',currency:'USD'})) });
    const result = await DerivClient.verifierEtAutoriser('app','test-token');
    assert.equal(result.ok,false);
    assert.equal(result.accounts.length,2);
  } finally { DerivClient._rest = rest; }
});

test('balance refresh does not resurrect a disconnected configuration', async () => {
  const read = DB.kvLire, write = DB.kvEcrire, verify = DerivClient.verifierEtAutoriser;
  const oldKey = process.env.DERIV_TOKEN_KEY;
  process.env.DERIV_TOKEN_KEY = 'ab'.repeat(32);
  let config = {appId:'app',apiToken:'test-token',account:{loginid:'DEMO1'},actif:true};
  try {
    DB.kvLire = async () => config;
    DB.kvEcrire = async (_key,value) => {config=value;};
    DerivClient.verifierEtAutoriser = async () => {
      await DerivClient.deconnecter();
      return {ok:true,account:{loginid:'DEMO1',balance:10}};
    };
    await assert.rejects(DerivClient.rafraichirSolde(), /configuration modifiée/);
    assert.equal(config,null);
  } finally {
    DB.kvLire=read; DB.kvEcrire=write; DerivClient.verifierEtAutoriser=verify;
    DerivClient._cachedConfig=null;
    if(oldKey===undefined) delete process.env.DERIV_TOKEN_KEY; else process.env.DERIV_TOKEN_KEY=oldKey;
  }
});
