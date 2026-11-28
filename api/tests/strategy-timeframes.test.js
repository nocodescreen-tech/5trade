'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../strategy-engine/orchestrateur-tf');
const fiche = {timeframes:{context:['H4'],confirmation:['H1'],execution:['M15']}};
const chargeur = dirs => async tf => dirs[tf] ? {direction:dirs[tf],status:'confirme',tf} : null;
test('required timeframe missing or neutral prevents alignment',async()=>{
  for(const dirs of [{H4:'BUY',H1:'BUY'},{H4:'BUY',M15:'BUY'},{H4:'NEUTRE',H1:'BUY',M15:'BUY'}]){
    const r=await O.confluenceStrategie(fiche,{chargerUnite:chargeur(dirs)});
    assert.equal(r.aligne,false);
    assert.ok(r.manquantes.length);
    assert.equal(r.detail.length,3);
  }
});
test('contradictory intermediate confirmation cannot be outvoted',async()=>{
  const r=await O.confluenceStrategie(fiche,{chargerUnite:chargeur({H4:'BUY',H1:'SELL',M15:'BUY'})});
  assert.equal(r.aligne,false);
  assert.match(r.motif,/conflit/);
});
test('no declared execution cannot be replaced by higher timeframe',async()=>{
  const r=await O.confluenceStrategie({timeframes:{context:['H4']}},{chargerUnite:chargeur({H4:'BUY'})});
  assert.equal(r.aligne,false);
});
