'use strict';
const crypto = require('node:crypto');
const Replay = require('./rejeu-direct');
function valider(candles,meta,profil,options={}) {
  if (!profil?.id || profil.executable === false || profil.partiel || !Array.isArray(profil.regles) || !profil.regles.length) throw Error('Profil exécutable explicite requis');
  const fenetre=options.fenetre ?? 60;
  const ratio=options.ratio ?? 0.7;
  const pas=options.pas ?? 5;
  if (!Number.isInteger(fenetre) || fenetre<60 || fenetre>300 || !Number.isFinite(ratio) || ratio<0.5 || ratio>0.8 || !Number.isInteger(pas) || pas<1 || pas>10) throw Error('Paramètres de validation invalides');
  const serie=(candles || []).filter(c=>c && c.closed!==false).sort((a,b)=>a.t-b.t);
  if (serie.some((c,i)=>!Number.isFinite(c.t) || (i>0 && c.t<=serie[i-1].t))) throw Error('Horodatages invalides ou dupliqués');
  const coupe=Math.floor(serie.length*ratio);
  if (coupe<fenetre+30 || serie.length-coupe<60) throw Error('Historique insuffisant pour deux périodes distinctes');
  const profilFige=JSON.parse(JSON.stringify(profil));
  const empreinte=crypto.createHash('sha256').update(JSON.stringify(profilFige)).digest('hex');
  // No fitting or model selection is performed. Warm-up uses only candles
  // preceding the first eligible holdout decision; no training trade crosses the split.
  const reference=serie.slice(0,coupe);
  const test=serie.slice(coupe-fenetre+1);
  const run = options.replay || Replay.rejouer;
  const reglages={fenetre,pas,maxEtapes:Math.ceil(serie.length/pas),initialCapital:options.initialCapital,riskPct:options.riskPct,
    optionsDecision:{exigerAlignement:false,verifierSession:true,verifierFrais:'strict'}};
  const moteur={profils:[profilFige],strategieStricte:true};
  const a=run(reference,meta,moteur,reglages);
  const b=run(test,meta,moteur,reglages);
  if (a.ok===false || b.ok===false) throw Error(a.error || b.error || 'Rejeu impossible');
  const stats = r=>({...r.stats,erreurs:(r.etapes || []).filter(e=>e.erreur).length});
  return {
    methode:'holdout_chronologique_mono_timeframe',
    profil:{id:profilFige.id,version:profilFige.version || null,empreinte},
    instrument:meta.symbol,timeframe:meta.timeframe,
    reference:{debut:reference[0].t,fin:reference.at(-1).t,bougies:reference.length,stats:stats(a)},
    test:{debut:serie[coupe].t,fin:serie.at(-1).t,bougies:serie.length-coupe,chauffe:fenetre-1,stats:stats(b)},
    evaluationIndependanteProuvee:false,
    limite:'Aucune optimisation ni preuve que cette période n’a jamais servi à concevoir la stratégie. Rejeu mono-timeframe avec configuration actuelle; pas de validation MTF historique, de calendrier historique ni de garantie de rentabilité.',
    statut:(b.stats?.avecR || 0)<30?'echantillon_insuffisant':'mesure_exploratoire'
  };
}
module.exports={valider};
