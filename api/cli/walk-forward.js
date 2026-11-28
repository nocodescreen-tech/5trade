#!/usr/bin/env node
'use strict';

const fs=require('node:fs/promises');
const {walkForward}=require('../engine/walk-forward');
const {rejouer}=require('../engine/rejeu-direct');
const {profilDepuisStrategie}=require('../engine/signals');
const {filtrerParClasse}=require('../strategy-engine/strategy-contract');
const Frais=require('../core/frais');

async function main(){
  const [file,output]=process.argv.slice(2);
  if(!file||!output)throw Error('Usage: node api/cli/walk-forward.js input.json output.json');
  const input=JSON.parse(await fs.readFile(file,'utf8'));
  if(typeof input.symbol!=='string'||typeof input.timeframe!=='string')throw Error('Instrument et unité requis');
  const docs=input.strategies;
  if(!Array.isArray(docs)||docs.length>8)throw Error('Maximum 8 stratégies');
  const compatible=filtrerParClasse(docs,input.symbol);
  const allowed=new Set((compatible.compatibles||[]).map(d=>d.id));
  const candidates=docs.filter(d=>allowed.has(d.id)&&d.actif!==false).map(profilDepuisStrategie).filter(p=>p.executable&&!p.partiel&&p.version!=null);
  const frais=Frais.configuration();
  if(!Frais.fraisPour(input.symbol,1,frais).connu)throw Error('Configurer les frais spécifiques à cet instrument avant le test');
  const result=await walkForward({
    candles:input.candles,candidates,train:input.train??600,test:input.test??400,
    run:(window,profile)=>rejouer(window,{symbol:input.symbol,timeframe:input.timeframe},
      {profils:[profile],strategie:{id:profile.id,titre:profile.titre},ignorerPreferences:true},
      {fenetre:Math.min(300,Math.floor(window.length/2)),pas:5,maxEtapes:window.length,optionsDecision:{exigerAlignement:false,verifierSession:true},frais})
  });
  await fs.writeFile(output,JSON.stringify({...result,symbol:input.symbol,timeframe:input.timeframe,createdAt:new Date().toISOString(),costConfig:frais,candidates},null,2),{flag:'wx'});
  if(!result.ok)process.exitCode=2;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
