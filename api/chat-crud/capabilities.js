'use strict';
// Inventory of deployed capabilities. Read-only evidence, never an LLM promise.
async function inspect(){
  const modules=[];
  const add=(id,label,status,detail)=>modules.push({id,label,status,detail});
  const db=require('../core/db');
  const sql=db.client();
  add('broker','Exécution courtier','disabled','Aucun ordre réel autorisé');
  add('replay','Market Replay','available','Rejeu éducatif isolé, session temporaire');
  add('gold','Contexte XAUUSD','partial','FRED quotidien, calendrier, aucune prédiction');
  add('research','Walk-forward','available','CLI hors ligne, coûts explicites, validation à exécuter');
  add('learning','Apprentissage autonome','restricted','Propositions de skills non exécutables sans revue');
  try{const active=require('../core/instruments-actifs').obtenirActifs();add('selection','Instruments','available',active.map(x=>x.symbol+'@'+x.provider).join(', ')||'Aucun');}catch{add('selection','Instruments','unavailable','Lecture impossible');}
  try{const prefs=await require('../memoire/preferences').lister();add('memory','Mémoire','available',prefs.length+' consigne(s) retournée(s) ; stockage '+(sql?'PostgreSQL':'fichiers'));}catch{add('memory','Mémoire','unavailable','Lecture impossible');}
  try{const skills=require('../skills/registry').lister();add('skills','Skills approuvés','available',skills.filter(s=>s.actif).map(s=>s.id+'@'+s.version).join(', ')||'Aucun actif');}catch{add('skills','Skills approuvés','unavailable','Registre indisponible');}
  if(sql){
    try{const s=await require('../delivery/telegram-outbox').repository(sql).status();add('telegram','Telegram outbox','available',JSON.stringify(s.summary));}catch{add('telegram','Telegram outbox','unavailable','File non accessible');}
    try{const s=await require('../engine/paper-observations').repository(sql).summary();add('paper','Observations prospectives','available',JSON.stringify(s));}catch{add('paper','Observations prospectives','unavailable','Stockage non accessible');}
  }else{
    add('telegram','Telegram outbox','unavailable','PostgreSQL requis');
    add('paper','Observations prospectives','unavailable','PostgreSQL requis');
  }
  return {at:new Date().toISOString(),modules,engines:require('../moteurs').etat()};
}
module.exports={inspect};
