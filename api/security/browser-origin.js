'use strict';
function configuredOrigin(origin,configured=process.env.APP_ORIGIN,env=process.env){
 if(typeof origin!=='string'||origin==='null')return false;
 let u;try{u=new URL(origin);}catch{return false;}
 if(!['http:','https:'].includes(u.protocol)||u.origin!==origin)return false;
 if(configured===origin)return true;
 return env.NODE_ENV!=='production'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname);
}
function allowed(req,configured=process.env.APP_ORIGIN,env=process.env){
 if(['GET','HEAD','OPTIONS'].includes(req.method))return true;
 const origin=req.get('Origin'),site=req.get('Sec-Fetch-Site');
 if(origin){
  if(configuredOrigin(origin,configured,env))return true;
  try{return origin===new URL(req.protocol+'://'+req.get('Host')).origin&&origin!=='null';}catch{return false;}
 }
 return site!=='cross-site'&&site!=='same-site';
}
function guard(req,res,next){if(!allowed(req))return res.status(403).json({success:false,error:'Origine de requête non autorisée'});next();}
module.exports={configuredOrigin,allowed,guard};
