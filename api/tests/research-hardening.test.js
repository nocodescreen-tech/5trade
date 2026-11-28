'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../engine/performance');
const W=require('../engine/walk-forward');
const Paper=require('../engine/paper-observations');
const Replay=require('../engine/market-replay');
const VP=require('../engine/volumeProfile');
test('unresolved returns never enter performance statistics',()=>{
 assert.equal(P.metriques([{r:null},{r:''},{r:false},{r:2}]).n,1);
});
test('no volume means no POC',()=>{
 assert.equal(VP.volumeProfile([{h:3,l:1,v:0},{h:4,l:2,v:0}]).poc,null);
});
test('walk-forward refuses insufficient history and bootstrap refuses insufficient evidence',async()=>{
 const x=await W.walkForward({candles:[],candidates:[{id:'s',version:1}],run:async()=>({trades:[]})});
 assert.equal(x.ok,false);
 assert.equal(W.blockBootstrap([{r:2}]).ok,false);
});
test('replay exposes no candle after cursor',()=>{
 const candles=Array.from({length:40},(_,i)=>({t:i*60000,o:100,h:102,l:99,c:101,closed:true}));
 const result=Replay.frame(candles,'1m',30);
 assert.equal(result.visible.at(-1).t,30*60000);
 assert.equal(result.done,false);
});
test('paper observation never treats ambiguous entry bar as a win',()=>{
 const obs={startAt:60000,expiresAt:180000,tfMs:60000,side:'long',entry:100,stop:95,targets:[110]};
 assert.equal(Paper.evaluate(obs,[{t:60000,o:100,h:111,l:94,c:105,closed:true}],120000).status,'ambiguous_entry_bar');
});
