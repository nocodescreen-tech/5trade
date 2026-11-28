'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../engine/DecisionEngine');
const J=require('../engine/journal-signaux');
const R=require('../engine/rejeu-direct');
const Risk=require('../risk/risque');
const candles=Array.from({length:70},(_,i)=>({t:1700000000000+i*60000,o:100,h:101,l:99,c:100,closed:true}));
test('closed position books its PnL exactly once; unresolved positions do not book PnL',()=>{
  const orig=[D.decider,J.evaluer,Risk.configuration];
  const sig={id:'fixture',sens:'long',entree:100,stop:99,objectifs:[101,102],executable:true};
  let appels=0;
  Risk.configuration=()=>({capital:1000,risquePct:1,maxRisqueTradePct:2,maxRisqueTotalPct:5,maxSimultanes:3});
  D.decider=()=>++appels===1?{decision:'ACHAT',signal:sig,risque:{ok:true}}:{decision:'NO_TRADE'};
  try{
    J.evaluer=(s)=>({...s,resultat:'tp2',r:2,rBrut:2,bougiesSuivies:2,leveLe:s.at+120000});
    const a=R.rejouer(candles,{symbol:'TEST',timeframe:'1m'},{},{fenetre:60,pas:1,maxEtapes:5,initialCapital:1000,riskPct:1});
    assert.equal(a.stats.capitalFinal,1020);
    assert.equal(a.stats.rNet,2);
    appels=0;
    J.evaluer=(s)=>({...s,resultat:'ouvert',r:2,rBrut:2,bougiesSuivies:8});
    const b=R.rejouer(candles,{symbol:'TEST',timeframe:'1m'},{},{fenetre:60,pas:1,maxEtapes:5,initialCapital:1000,riskPct:1});
    assert.equal(b.stats.capitalFinal,1000);
    assert.equal(b.stats.avecR,0);
    assert.equal(b.stats.positionsNonCloturees,1);
    assert.equal(b.trades[0].clotureAt,null);
  }finally{[D.decider,J.evaluer,Risk.configuration]=orig;}
});
test('statistics exclude open outcomes even if they carry a provisional R',()=>{
  const s=R.statistiques([{resultat:'ouvert',rNet:10,rBrut:10},{resultat:'sl',rNet:-1,rBrut:-1}]);
  assert.equal(s.avecR,1);
  assert.equal(s.rNet,-1);
});
