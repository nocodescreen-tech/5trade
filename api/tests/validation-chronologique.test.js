'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const V=require('../engine/validation-chronologique');
const serie=Array.from({length:300},(_,i)=>({t:1700000000000+i*60000,o:100,h:101,l:99,c:100,closed:true}));
const profil={id:'test',version:'1.0.0',regles:['R1'],executable:true};
const meta={symbol:'XAUUSD',timeframe:'1m'};
test('holdout first decision is on split and reference sees no future outcome',()=>{
  const calls=[];
  const r=V.valider(serie,meta,profil,{ratio:0.7,replay:(candles,meta,opts,settings)=>{
    calls.push({candles,opts,settings});
    return {stats:{avecR:3},etapes:[]};
  }});
  assert.equal(calls.length,2);
  assert.equal(calls[0].candles.at(-1).t,serie[209].t);
  assert.equal(calls[1].candles[59].t,serie[210].t);
  assert.deepEqual(calls[0].opts.profils,calls[1].opts.profils);
  assert.notEqual(calls[0].opts.profils[0],profil);
  assert.equal(r.test.debut,serie[210].t);
  assert.equal(r.test.bougies,90);
  assert.equal(r.evaluationIndependanteProuvee,false);
  assert.equal(r.statut,'echantillon_insuffisant');
});
test('invalid profile, duplicate dates and insufficient history are rejected',()=>{
  assert.throws(()=>V.valider(serie,meta,{...profil,partiel:true}),/Profil/);
  assert.throws(()=>V.valider([...serie,serie[0]],meta,profil),/dupliqués/);
  assert.throws(()=>V.valider(serie.slice(0,100),meta,profil),/insuffisant/);
});
