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

const Paper = require('../engine/paper-observations');
const Fundamentals = require('../sources/fundamentals');
const Context = require('../moteurs/market-context');
const now = Date.parse('2026-11-24T13:00:00Z');
const step = 300000;
const row = {decision:'ACHAT', symbole:'frxXAUUSD', provider:'deriv', tf:'5m', contrat:plan};
const profile = {id:'smc-test', version:1};
const candle = {t:now-step,c:100,closed:true};
const costs = {connu:true,total:0.2};
test('observation rejects unversioned strategies, unknown costs and future data', () => {
  assert.equal(Paper.buildObservation(row, {id:'x'}, [candle], costs, step, now), null);
  assert.equal(Paper.buildObservation(row, profile, [candle], {connu:false,total:0}, step, now), null);
  assert.equal(Paper.buildObservation(row, profile, [{...candle,t:now}], costs, step, now), null);
  const observation = Paper.buildObservation(row, profile, [candle], costs, step, now);
  assert.ok(observation);
  assert.equal(observation.startAt, now);
  assert.equal(observation.id, Paper.buildObservation(row, profile, [candle], costs, step, now).id);
});
test('prospective evidence distinguishes ambiguity from a target touch', () => {
  const o = Paper.buildObservation(row, profile, [candle], costs, step, now);
  const entry = {t:now,o:101,h:103,l:99,c:102,closed:true};
  const tp2 = {t:now+step,o:102,h:121,l:101,c:119,closed:true};
  const both = {...tp2,l:94};
  assert.equal(Paper.evaluate(o,[entry,tp2],now+2*step).status,'tp2_touched');
  assert.equal(Paper.evaluate(o,[entry,both],now+2*step).status,'ambiguous_exit_bar');
  assert.equal(Paper.evaluate(o,[{...entry,h:111}],now+step).status,'ambiguous_entry_bar');
  assert.equal(Paper.evaluate(o,[entry,{...tp2,t:now+2*step}],now+3*step).status,'data_gap');
  assert.equal(Paper.evaluate(o,[entry,tp2],now+step),null);
});
test('macro filter preserves canonical timestamp and distinguishes uncertain schedules', () => {
  const e = {timestamp:now+600000, date:'Nov 24', heure:'08:10', devise:'USD', impact:'high', titre:'CPI'};
  const result = Fundamentals.verdictDevise([e],'USD',{maintenant:new Date(now)});
  assert.equal(result.bloque,true);
  assert.equal(result.horodatageSource,e.timestamp);
  assert.match(result.heureKinshasa,/14:10/);
  assert.equal(Fundamentals.verdictDevise([{...e,timestamp:null,heure:'Tentative'}],'USD',{maintenant:new Date(now)}).verifie,false);
  assert.deepEqual(Fundamentals.devisesDuSymbole('frxXAUUSD').devises,['USD']);
});
test('market contexts expose missing data rather than claiming a complete engine', () => {
  const prices = Array.from({length:40},(_,i)=>100+i/10+Math.sin(i));
  const metal = Context.analyse('metaux',prices,{symbol:'frxXAUUSD',now,live:false});
  assert.equal(metal.convient,true);
  assert.ok(metal.manquants.some(x=>/Rendements/.test(x)));
  assert.equal(Context.analyse('crypto',prices,{symbol:'frxXAUUSD'}).convient,false);
});
