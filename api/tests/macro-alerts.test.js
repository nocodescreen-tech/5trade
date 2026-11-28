'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Fund = require('../sources/fundamentals');
const Macro = require('../delivery/macro-alerts');
const at = Date.parse('2026-12-02T13:30:00Z');
const event = {horodatageSource:at,devise:'USD',impact:'high',titre:'US CPI <test>',source:'fixture'};
test('source timestamp is preserved and unknown major release time is not verified',()=>{
  assert.equal(Fund.instantEvenement(event),at);
  assert.equal(Fund.instantEvenement({date:'Feb 30',heure:'9:30am'}),null);
  assert.equal(Fund.verdictDevise([event],'USD',{maintenant:new Date(at-30*60000)}).bloque,true);
  assert.equal(Fund.verdictDevise([event],'USD',{maintenant:new Date(at-30*60000-1)}).bloque,false);
  assert.equal(Fund.verdictDevise([{...event,horodatageSource:null,date:'Dec 2',heure:'Tentative'}],'USD',{maintenant:new Date(at)}).verifie,false);
});
test('macro warnings only cover selected instruments, with distinct pre/post keys',()=>{
  const actifs = [{symbol:'frxXAUUSD'},{symbol:'R_75'}];
  const avant = Macro.planifier([event],actifs,at-10*60000);
  const apres = Macro.planifier([event],actifs,at+60000);
  assert.equal(avant.length,1);
  assert.match(avant[0].texte,/frxXAUUSD/);
  assert.match(avant[0].texte,/Kinshasa/);
  assert.match(avant[0].texte,/&lt;test&gt;/);
  assert.doesNotMatch(avant[0].texte,/R_75/);
  assert.notEqual(avant[0].key,apres[0].key);
  assert.equal(Macro.planifier([event],[{symbol:'R_75'}],at).length,0);
});
test('failed deliveries retry, confirmed deliveries deduplicate, stale calendar never sends',async()=>{
  const sent = new Set();
  let attempts=0;
  const deps = {now:at-60000,calendrier:async()=>({sourceDisponible:true,events:[event]}),actifs:()=>[{symbol:'XAUUSD'}],tracker:{
    estDejaEnvoye:key=>sent.has(key),
    envoyerTelegramSecurise:async()=>({ok:++attempts>1,messageId:123}),
    marquerEnvoye:key=>sent.add(key)
  }};
  const cfg={telegramToken:'fake',telegramChat:'fake'};
  assert.equal((await Macro.notifier(cfg,deps)).envoyes,0);
  assert.equal((await Macro.notifier(cfg,deps)).envoyes,1);
  assert.equal((await Macro.notifier(cfg,deps)).envoyes,0);
  deps.calendrier=async()=>({sourceDisponible:false,events:[event]});
  assert.equal((await Macro.notifier(cfg,deps)).verifie,false);
  assert.equal(attempts,2);
});
