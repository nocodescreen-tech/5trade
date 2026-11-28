'use strict';
// Daily public macro observations, not real-time prices. Do not backfill
// these current/revisable observations into historical decisions.
const SERIES=Object.freeze({DGS10:'US Treasury 10Y nominal (%)',DFII10:'US Treasury 10Y real (%)',DTWEXBGS:'Broad US dollar index'});
const DAY=86400000;
function parseCSV(text,id,now=Date.now()){
  if(!Object.hasOwn(SERIES,id))throw Error('Série non autorisée');
  const lines=String(text).trim().split(/\r?\n/);
  if(!lines[0]?.includes(id))throw Error('Format FRED invalide');
  const values=[];
  for(const line of lines.slice(1)){
    const [date,raw]=line.split(',');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!raw?.trim()||raw==='.')continue;
    const t=Date.parse(date+'T00:00:00Z'),value=Number(raw);
    if(Number.isFinite(t)&&Number.isFinite(value)&&t<=now)values.push({date,t,value});
  }
  const unique=[...new Map(values.map(v=>[v.t,v])).values()].sort((a,b)=>a.t-b.t);
  if(unique.length<6)throw Error('Historique macro insuffisant');
  const last=unique.at(-1),prior=unique.at(-6);
  return {id,label:SERIES[id],latest:last.value,date:last.date,ageDays:Math.floor((now-last.t)/DAY),
    change5: +(last.value-prior.value).toFixed(4),change5Pct: prior.value!==0?+((last.value/prior.value-1)*100).toFixed(4):null,
    available:now-last.t<=7*DAY,source:'FRED',frequency:'daily'};
}
let cache=null,pending=null;
async function snapshot({fetcher=globalThis.fetch,now=Date.now(),force=false}={}){
  if(!force&&cache&&now-cache.fetchedAt<3600000)return cache;
  if(pending)return pending;
  pending=(async()=>{
    const rows=await Promise.all(Object.keys(SERIES).map(async id=>{
      try{
        const start=new Date(now-45*DAY).toISOString().slice(0,10);
        const url='https://fred.stlouisfed.org/graph/fredgraph.csv?id='+id+'&cosd='+start;
        const r=await fetcher(url,{signal:AbortSignal.timeout(9000),headers:{Accept:'text/csv'}});
        if(!r.ok)throw Error('HTTP '+r.status);
        return parseCSV(await r.text(),id,now);
      }catch{return {id,label:SERIES[id],available:false,source:'FRED',reason:'Donnée indisponible ou invalide'};}
    }));
    const result={fetchedAt:now,available:rows.every(x=>x.available),series:rows,note:'Séries quotidiennes révisables, aucun signal automatique ni prix temps réel.'};
    cache=result;return result;
  })();
  try{return await pending;}finally{pending=null;}
}
module.exports={SERIES,parseCSV,snapshot};
