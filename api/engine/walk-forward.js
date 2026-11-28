'use strict';

const Performance=require('./performance');
const {aleatoire}=require('./quantitative');

const average=values=>values.reduce((a,b)=>a+b,0)/values.length;

function blockBootstrap(trades,{iterations=2000,block=5,seed=42,riskPct=1}={}){
  const returns=Performance.exploitables(trades).map(t=>t.r);
  if(returns.length<30)return {ok:false,reason:'Au moins 30 résultats tranchés requis'};
  if(!Number.isFinite(riskPct)||riskPct<=0||riskPct>2)return {ok:false,reason:'Risque hors limites'};
  const n=returns.length;
  iterations=Math.max(100,Math.min(5000,Math.floor(iterations)||2000));
  block=Math.max(1,Math.min(n,Math.floor(block)||5));
  const random=aleatoire(seed),totals=[],drawdowns=[];
  for(let i=0;i<iterations;i++){
    let equity=1,peak=1,dd=0,j=0;
    while(j<n){
      const start=Math.floor(random()*n);
      for(let k=0;k<block&&j<n;k++,j++){
        const r=returns[(start+k)%n];
        equity=Math.max(0,equity*(1+r*riskPct/100));
        peak=Math.max(peak,equity);
        dd=Math.max(dd,1-equity/peak);
      }
    }
    totals.push((equity-1)*100);drawdowns.push(dd*100);
  }
  totals.sort((a,b)=>a-b);drawdowns.sort((a,b)=>a-b);
  const q=(xs,p)=>+xs[Math.floor((xs.length-1)*p)].toFixed(2);
  return {ok:true,method:'circular_block_bootstrap',sample:n,iterations,block,seed,riskPct,
    returnPct:{p05:q(totals,.05),median:q(totals,.5),p95:q(totals,.95)},
    maxDrawdownPct:{median:q(drawdowns,.5),p95:q(drawdowns,.95)},
    negativePathsPct:+(100*totals.filter(x=>x<0).length/iterations).toFixed(2),
    caveat:'Scénarios conditionnels aux résultats historiques, pas une probabilité de perte future.'};
}

// Rolling historical selection. Candidates are frozen before the experiment.
// No overlapping validation periods, no validation data in selection, no
// position carried across folds. The backtester must return net closed trades.
async function walkForward({candles,candidates,run,train=600,test=400,minTrades=20,maxFolds=10}={}){
  if(!Array.isArray(candles)||!Array.isArray(candidates)||typeof run!=='function')throw Error('Données et moteur requis');
  if(!Number.isInteger(train)||train<100||!Number.isInteger(test)||test<100||!Number.isInteger(minTrades)||minTrades<10)throw Error('Fenêtres invalides');
  if(candidates.length<1||candidates.length>8||new Set(candidates.map(c=>c.id)).size!==candidates.length||candidates.some(c=>!c.id||c.version==null))throw Error('1 à 8 candidats distincts et versionnés requis');
  const fixed=JSON.parse(JSON.stringify(candidates));
  const series=candles.filter(c=>c?.closed!==false).slice().sort((a,b)=>a.t-b.t);
  if(series.some((c,i)=>!c||![c.t,c.o,c.h,c.l,c.c].every(Number.isFinite)||(i&&c.t<=series[i-1].t)||c.h<Math.max(c.o,c.l,c.c)||c.l>Math.min(c.o,c.c)))throw Error('Historique invalide');
  if(series.length<train+test)return {ok:false,reason:'Historique insuffisant',folds:[]};
  const folds=[],results=[];
  const limit=Math.min(20,Math.max(1,Math.floor(maxFolds)||10));
  async function assess(window,profile){
    const r=await run(window.map(c=>({...c})),JSON.parse(JSON.stringify(profile)));
    if(!r||r.ok===false||!Array.isArray(r.trades))return {metrics:Performance.metriques([]),trades:[],reason:r?.error||'Rejeu indisponible'};
    const valid=r.trades.filter(t=>['tp1','tp2','be','sl','expire'].includes(t.resultat)&&Number.isFinite(t.rNet)&&t.fraisConnus===true&&Number.isFinite(t.at)&&Number.isFinite(t.clotureAt)&&t.at>=window[0].t&&t.clotureAt>t.at&&t.clotureAt<=window.at(-1).t)
      .map(t=>({r:t.rNet,at:t.at,closAt:t.clotureAt}));
    return {metrics:Performance.metriques(valid),trades:valid};
  }
  for(let offset=0;offset+train+test<=series.length&&folds.length<limit;offset+=test){
    const training=series.slice(offset,offset+train);
    const validation=series.slice(offset+train,offset+train+test);
    const scores=[];
    for(const p of fixed){const result=await assess(training,p);scores.push({id:p.id,version:p.version,...result.metrics,reason:result.reason||null});}
    scores.sort((a,b)=>(b.expectancyR??-Infinity)-(a.expectancyR??-Infinity)||String(a.id).localeCompare(String(b.id)));
    const selected=scores.find(s=>s.n>=minTrades&&s.expectancyR>0);
    const fold={trainFrom:training[0].t,trainTo:training.at(-1).t,testFrom:validation[0].t,testTo:validation.at(-1).t,training:scores,selected:selected?{id:selected.id,version:selected.version}:null};
    if(selected){const result=await assess(validation,fixed.find(p=>p.id===selected.id));fold.validation=result.metrics;fold.reason=result.reason||null;results.push(...result.trades);}
    else{fold.validation=null;fold.reason='Aucun candidat admissible sur entraînement';}
    folds.push(fold);
  }
  return {ok:true,method:'rolling_selection_disjoint_test',folds,outOfSample:Performance.metriques(results),
    bootstrap:blockBootstrap(results),caveat:'Chaque fenêtre est rejouée isolément, avec coûts déclarés et période de chauffe interne. Aucun avantage futur garanti.'};
}

module.exports={walkForward,blockBootstrap};
