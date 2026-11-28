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

const TelegramAuth=require('../delivery/telegram-auth');
const Outbox=require('../delivery/telegram-outbox');
const Perf=require('../engine/performance');
const Quant=require('../engine/quantitative');
const WF=require('../engine/walk-forward');
const Flow=require('../engine/orderFlow');
const VP=require('../engine/volumeProfile');

test('Telegram requires secret, configured private chat and owner',()=>{
  const secret='0123456789abcdefghijklmnop';
  const update={message:{chat:{id:42,type:'private'},from:{id:42},text:'/recap'}};
  assert.equal(TelegramAuth.authorizeUpdate(update,secret,secret,'42').ok,true);
  assert.equal(TelegramAuth.authorizeUpdate(update,'wrong',secret,'42').status,401);
  assert.equal(TelegramAuth.authorizeUpdate(update,secret,secret,'43').status,403);
  assert.equal(TelegramAuth.authorizeUpdate(update,secret,'','42').status,503);
  assert.equal(TelegramAuth.authorizeUpdate({...update,message:{...update.message,from:{id:43}}},secret,secret,'42').status,403);
});
test('outbox retries only explicit rate-limit rejection and records uncertainty',async()=>{
  const job={attempts:1,expires_at:new Date(now+600000)};
  assert.equal(Outbox.transition(job,{ok:true,messageId:100},now).state,'sent');
  assert.equal(Outbox.transition(job,{ok:false,kind:'uncertain'},now).state,'uncertain');
  assert.equal(Outbox.transition(job,{ok:false,kind:'rate_limit',retryAfterMs:2000},now).state,'pending');
  assert.equal(Outbox.transition({...job,attempts:5},{ok:false,kind:'rate_limit'},now).state,'failed');
  const result=await Outbox.sendOnce('fake','42','test',{},async()=>{throw Error('network')});
  assert.equal(result.kind,'uncertain');
});
test('performance excludes null, blank, boolean and sorts numerical timestamps',()=>{
  const rows=[{at:4,r:1},{at:1,r:-1},{at:2,r:null},{at:3,r:''},{at:5,r:false}];
  assert.equal(Perf.metriques(rows).n,2);
  assert.deepEqual(Perf.exploitables(rows).map(t=>t.r),[-1,1]);
  assert.equal(Quant.ratios([{r:1},{r:1},{r:1},{r:-1}]).sortino,1);
});
test('bootstrap is reproducible and rolling selection never tests rejected candidates',async()=>{
  const trades=Array.from({length:50},(_,i)=>({r:i%3===0?-1:1.2,at:i+1}));
  const sample=WF.blockBootstrap(trades,{iterations:100,seed:9});
  assert.deepEqual(sample,WF.blockBootstrap(trades,{iterations:100,seed:9}));
  const candles=Array.from({length:300},(_,i)=>({t:i*step,o:100,h:101,l:99,c:100,closed:true}));
  const calls=[];
  const result=await WF.walkForward({candles,candidates:[{id:'a',version:1},{id:'b',version:1}],train:100,test:100,
    run:async(window,p)=>{
      calls.push([window[0].t,p.id]);
      return {trades:window.slice(1,25).map(c=>({at:c.t,clotureAt:c.t+step,resultat:'tp1',rNet:p.id==='a'?1:-1,fraisConnus:true}))};
    }});
  assert.equal(result.folds.length,2);
  assert.equal(result.folds[0].selected.id,'a');
  assert.deepEqual(calls.slice(0,3),[[0,'a'],[0,'b'],[100*step,'a']]);
  assert.equal(result.outOfSample.n,48);
});
test('real taker volume produces delta and missing volume cannot produce POC',()=>{
  const c={o:100,h:102,l:99,c:101,v:10,takerBuyBase:7,volumeSource:'binance_spot'};
  const flow=Flow.analyserOrderFlow([{...c,t:1},{...c,t:2}]);
  assert.equal(flow.methode,'delta_taker_binance_spot');
  assert.equal(flow.delta[0],4);
  assert.equal(flow.cvd[0].value,4);
  assert.equal(VP.volumeProfile([{...c,v:0},{...c,v:0}]).poc,null);
  assert.equal(Flow.analyserOrderFlow([{...c,v:0},{...c,v:0}]).disponible,false);
});
test('replay capital is settled once rather than credited twice',()=>{
  const Replay=require('../engine/rejeu-direct');
  const candles=Array.from({length:80},(_,i)=>({t:(i+1)*step,o:100,h:110,l:95,c:101,closed:true}));
  let issued=false;
  const run=Replay.rejouer(candles,{symbol:'TEST',timeframe:'5m'},{sansRisqueCompte:true},{
    fenetre:60,pas:5,initialCapital:1000,riskPct:1,
    decider:()=>{
      if(issued)return {decision:'ATTENTE'};
      issued=true;return {decision:'ACHAT',signal:{id:'test',sens:'long',executable:true,entree:100,stop:95,objectifs:[110]},risque:{ok:true}};
    },
    evaluer:s=>({...s,resultat:'tp1',r:2,rBrut:2,leveLe:s.at+step,bougiesSuivies:1,cout:{connu:true,enR:0}})
  });
  assert.equal(run.stats.capitalFinal,1020);
  assert.equal(run.stats.positionsMaxSimultanees,1);
});

test('TP2 cannot substitute for missing TP1',()=>{
  const raw={direction:'BUY',status:'confirme',strength:.8,levels:{entry:100,stop:95,target2:120}};
  const contract=C.normaliser(raw,{source:'scan'});
  assert.deepEqual(contract.objectifs,[null,120]);
  assert.equal(C.validerSignal(contract).ok,false);
  assert.equal(C.versContrat(raw).executablePossible,false);
});
test('journal never counts an already processed candle twice',()=>{
  const J=require('../engine/journal-signaux');
  const sig={at:1,symbol:'TEST',sens:'long',entree:100,stop:95,objectifs:[110,120],resultat:'ouvert'};
  const bars=[{t:2,o:100,h:104,l:99,c:103,closed:true}];
  J.evaluer(sig,bars);
  J.evaluer(sig,bars);
  assert.equal(sig.bougiesSuivies,1);
  J.evaluer(sig,[...bars,{t:3,o:103,h:106,l:101,c:105,closed:true}]);
  assert.equal(sig.bougiesSuivies,2);
});

test('calendar normalizes currency codes and rejects local timestamps',()=>{
  const N=require('../sources/news');
  assert.equal(N.normaliserEvenement({country:'USD',date:'2026-11-24T13:00:00Z',impact:'High'}).devise,'USD');
  assert.equal(N.normaliserEvenement({country:'US',date:'2026-11-24T13:00:00',impact:'High'}).date,null);
  assert.deepEqual(Fundamentals.devisesDuSymbole('GER40').devises,['EUR']);
  assert.equal(Fundamentals.verdictDevise([{devise:'USD',timestamp:null,date:null,heure:null,impact:'high'}],'USD',{maintenant:new Date(now)}).verifie,false);
});
test('FRED observation parser keeps dates and skips missing values',()=>{
  const M=require('../sources/gold-macro');
  const csv='observation_date,DFII10\n2026-11-17,1.1\n2026-11-18,1.2\n2026-11-19,1.3\n2026-11-20,.\n2026-11-21,1.4\n2026-11-22,1.5\n2026-11-23,1.6\n2026-12-01,9';
  const m=M.parseCSV(csv,'DFII10',now);
  assert.equal(m.latest,1.6);assert.equal(m.change5,.5);assert.equal(m.available,true);
});
test('replay frame exposes no future candles',()=>{
  const Replay=require('../engine/market-replay');
  const bars=Array.from({length:100},(_,i)=>({t:(i+1)*step,o:100,h:102,l:98,c:101,closed:true}));
  const r=Replay.frame(bars,'5m',40);
  assert.equal(r.visible.at(-1).t,bars[40].t);
  assert.equal(r.visible.length,41);
  assert.equal(r.asOf,bars[40].t+step);
  assert.throws(()=>Replay.frame(bars,'5m',100));
});

test('Telegram alert escapes untrusted labels, refuses invented lot sizes and null prices',()=>{
  const A=require('../delivery/alerts');
  const message=A.messageTelegram({direction:'BUY',strength:.8,levels:{entry:null,stop:null,target1:null,target2:null},rules:[{name:'<b>fake</b>',detail:'a & b'}]}, {symbol:'XAUUSD',tf:'5m'});
  assert.match(message,/Entrée : <b>non chiffrée<\/b>/);
  assert.match(message,/&lt;b&gt;fake&lt;\/b&gt;/);
  assert.doesNotMatch(message,/Taille conseillée/);
  assert.doesNotMatch(message,/Objectif 1/);
});
test('market closure preserves completed history and refuses incomplete current bars',()=>{
  const M=require('../sources/market');
  const bars=[{t:0,closed:true},{t:60000,closed:true}];
  assert.deepEqual(M.marquerEnCours(bars,'1m',90000).map(c=>c.closed),[true,false]);
  assert.deepEqual(M.marquerEnCours(bars,'1m',120000).map(c=>c.closed),[true,true]);
  assert.equal(M.marquerEnCours([{t:0,closed:false}],'1m',120000)[0].closed,false);
});
