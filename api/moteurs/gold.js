'use strict';
const Context=require('./market-context');
const Macro=require('../sources/gold-macro');
function analyse(closes,meta={}){
  const base=Context.analyse('metaux',closes,meta);
  if(!/^(frx)?XAUUSD$/i.test(meta.symbol||''))return base;
  const data=meta.goldMacro;
  const dollar=data?.series?.find(s=>s.id==='DTWEXBGS'&&s.available);
  const real=data?.series?.find(s=>s.id==='DFII10'&&s.available);
  const nominal=data?.series?.find(s=>s.id==='DGS10'&&s.available);
  base.contexte.gold={available:Boolean(dollar&&real&&nominal),dollar:dollar||null,realYield:real||null,nominalYield:nominal||null,
    environment:dollar&&real?(dollar.change5>0&&real.change5>0?'dollar_et_rendement_en_hausse':dollar.change5<0&&real.change5<0?'dollar_et_rendement_en_baisse':'mixte'):'indisponible',
    note:'Contexte macro descriptif. Les variations ne prédisent pas le prix de l’or.'};
  base.manquants=base.manquants.filter(x=>x!=='Rendements US, dollar, coûts de portage');
  if(!base.contexte.gold.available)base.manquants.push('Dollar et rendements US actualisés');
  base.manquants.push('Portage et microstructure du fournisseur');
  return base;
}
module.exports={analyse,snapshot:Macro.snapshot};
