'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../engine/contrat');
const plan = {
  id: 'test', source: 'strategie', nom: 'test', tf: '5m', sens: 'long',
  direction: 'BUY', status: 'confirme', force: 0.8, conditions: [], preuves: [],
  entree: 100, stop: 95, objectifs: [110, 120], rr: 2
};
test('valid plan passes and malformed objectives are not silently removed', () => {
  assert.equal(C.validerSignal(plan).ok, true);
  assert.equal(C.validerSignal({...plan, objectifs: [110, 'bad']}).ok, false);
  assert.equal(C.validerSignal(C.normaliser({...plan, objectifs: ['bad', 120]})).ok, false);
  assert.equal(C.validerSignal({...plan, objectifs: [110, 120, 115]}).ok, false);
  assert.equal(C.validerSignal({...plan, sens: 'neutre'}).ok, false);
  assert.equal(C.validerSignal({...plan, direction: 'SELL'}).ok, false);
});
test('untrusted code is never evaluated', () => {
  const sandbox = require('../skills/sandbox');
  assert.equal(sandbox.chargerDansSandbox('throw new Error("must not execute")').ok, false);
  assert.throws(() => sandbox.creerContexteSecurise(), /désactivée/);
});
test('execution is suspended at HTTP and broker layers', () => {
  const api = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const broker = fs.readFileSync(path.join(__dirname, '../deriv/client.js'), 'utf8');
  const route = api.slice(api.indexOf("app.post('/api/deriv/trade'"), api.indexOf('// ─── Dashboard temps réel'));
  assert.match(route, /503/);
  assert.match(route, /EXECUTION_DISABLED/);
  assert.doesNotMatch(route, /DerivBroker\.executerTrade/);
  assert.match(broker, /async executerTrade\(\)\s*\{/);
  assert.doesNotMatch(broker, /buy:\s*propRes/);
});
