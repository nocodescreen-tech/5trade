'use strict';
const {TF_MS}=require('../sources/market');
function frame(candles,tf,cursor,window=120){
  if(!TF_MS[tf])throw Error('Timeframe invalide');
  if(!Array.isArray(candles))throw Error('Historique invalide');
  const series=candles.filter(c=>c&&c.closed!==false).sort((a,b)=>a.t-b.t);
  if(series.length<35||series.some((c,i)=>![c.t,c.o,c.h,c.l,c.c].every(Number.isFinite)||(i&&c.t<=series[i-1].t)||c.h<Math.max(c.o,c.c,c.l)||c.l>Math.min(c.o,c.c)))throw Error('Historique incomplet ou invalide');
  if(!Number.isInteger(cursor)||cursor<30||cursor>=series.length)throw Error('Curseur hors limites');
  window=Math.max(30,Math.min(300,Math.floor(window)||120));
  const visible=series.slice(Math.max(0,cursor-window+1),cursor+1);
  return {cursor,total:series.length,visible,at:visible.at(-1).t,asOf:visible.at(-1).t+TF_MS[tf],done:cursor===series.length-1};
}
module.exports={frame};
