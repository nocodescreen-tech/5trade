'use strict';
function allowed(req,configured=process.env.APP_ORIGIN){
 const method=String(req.method||'GET').toUpperCase();
 if(['GET','HEAD','OPTIONS'].includes(method))return true;
 // Telegram has independent secret and sender checks.
 if(method==='POST'&&req.path==='/alerts/telegram/webhook')return true;
 const origin=req.get('Origin');
 const site=req.get('Sec-Fetch-Site');
 if(site==='cross-site')return false;
 if(!origin)return true; // Non-browser clients; session/auth checks still apply.
 let parsed;try{parsed=new URL(origin);}catch{return false;}
 if(!['http:','https:'].includes(parsed.protocol)||parsed.origin!==origin)return false;
 if(configured&&origin===configured)return true;
 const host=String(req.get('Host')||'').toLowerCase();
 return parsed.host.toLowerCase()===host;
}
function guard(req,res,next){
 if(!allowed(req))return res.status(403).json({success:false,error:'Origine de requête non autorisée'});
 next();
}
module.exports={allowed,guard};
