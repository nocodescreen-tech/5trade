'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Scan = require('../delivery/scan');
const modes = Scan.MODES_SCAN;
const makeCandles = () => Array.from({length:40},(_,i)=>({t:Date.now()-(40-i)*900000,o:100,h:101,l:99,c:100.5,v:10,closed:true}));
test('explicit empty selection clears previous scan results and makes no network requests',async()=>{
  const market={listSymbols:()=>[{symbol:'frxXAUUSD',provider:'deriv'}],getCandles:async()=>{throw Error('must not fetch');}};
  const r=await Scan.scanComplet({market,signals:{},mode:modes.SURVEILLANCE,symbolesAutorises:[]});
  assert.equal(r.marches,0);
  assert.deepEqual(r.resultats,[]);
  assert.equal(Scan.dernierScan().dernier.marches,0);
});
test('provider selection is exact and offline data cannot produce a candidate',async()=>{
  const calls=[];
  const market={listSymbols:()=>[{symbol:'XAUUSD',provider:'deriv'},{symbol:'XAUUSD',provider:'yahoo'}],getCandles:async(s,tf,n,p)=>{calls.push(p);return {offline:true,candles:makeCandles()};}};
  const r=await Scan.scanComplet({market,signals:{decider:()=>{throw Error('must not evaluate offline data');}},mode:modes.SURVEILLANCE,symbolesAutorises:[{symbol:'XAUUSD',provider:'yahoo'}]});
  assert.deepEqual(calls,['yahoo']);
  assert.equal(r.signaux,0);
  assert.match(r.erreurs[0],/hors ligne/);
});
test('selected profile is passed intact to DecisionEngine, without generic fallback',async()=>{
  const profil={id:'test',regles:['R1'],obligatoires:['R1'],marches:['forex']};
  const market={listSymbols:()=>[{symbol:'EURUSD',provider:'forex'}],getCandles:async()=>({candles:makeCandles()})};
  let seen;
  const r=await Scan.scanComplet({market,signals:{decider:(c,m,o)=>{seen=o;return {decision:'NO_TRADE',raison:'fixture'};}},mode:modes.SURVEILLANCE,symbolesAutorises:['EURUSD'],strategies:[profil]});
  assert.deepEqual(seen?.profils,[profil]);
  assert.equal(seen.strategieStricte,true);
  assert.equal(r.signaux,0);
});
