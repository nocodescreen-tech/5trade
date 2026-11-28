'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'5trade-market-'));
process.env.MARKET_CACHE_FICHIER = path.join(dir,'cache.json');
const Market = require('../sources/market');
test('concurrent identical history requests share one fetch and isolated candle copies',async()=>{
  const p=Market.providerById('deriv');
  const original=p.candles;
  let calls=0;
  const now=Date.now();
  p.candles=async()=>{calls++;await new Promise(r=>setTimeout(r,10));return [{t:now-60000,o:100,h:102,l:99,c:101,closed:true},{t:now,o:101,h:103,l:100,c:102,closed:true}];};
  try{
    const [a,b]=await Promise.all([Market.getCandles('R_75','1m',2,'deriv'),Market.getCandles('R_75','1m',2,'deriv')]);
    assert.equal(calls,1);
    a.candles[0].c=999;
    assert.equal(b.candles[0].c,101);
    assert.equal((await Market.getCandles('R_75','1m',2,'deriv')).candles[0].c,101);
    assert.equal(calls,1);
  }finally{p.candles=original;}
});
test('disk cache is marked offline when live source fails',async()=>{
  const p=Market.providerById('deriv');
  const original=p.candles;
  const now=Date.now()-86400000;
  fs.writeFileSync(process.env.MARKET_CACHE_FICHIER,JSON.stringify({'deriv|R_25|1m':[{t:now,o:100,h:102,l:99,c:101,closed:true}]}));
  Market.loadCache();
  let calls=0;
  p.candles=async()=>{calls++;throw Error('fixture unavailable');};
  try{
    const r=await Market.getCandles('R_25','1m',1,'deriv');
    assert.equal(calls,1);
    assert.equal(r.offline,true);
    assert.equal(r.source,'cache');
  }finally{p.candles=original;}
});
test.after(async()=>{await new Promise(r=>setTimeout(r,5100));fs.rmSync(dir,{recursive:true,force:true});});
