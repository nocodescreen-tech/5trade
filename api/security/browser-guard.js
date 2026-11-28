'use strict';
const SAFE=new Set(['GET','HEAD','OPTIONS']);
function originOf(value){
 if(typeof value!=='string'||value.length>2048)return null;
 try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&u.origin===value?u.origin:null;}catch{return null;}
}
function allowedOrigin(origin,configured,production){
 const valid=originOf(origin);
 if(!valid)return false;
 if(valid===originOf(configured))return true;
 if(!production&&/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(valid))return true;
 return false;
}
function check(req,{appOrigin,production}={}){
 if(SAFE.has(req.method))return true;
 const origin=req.get('origin'),site=req.get('sec-fetch-site');
 if(site==='cross-site')return false;
 if(!origin)return !site||site==='same-origin'||site==='none';
 if(allowedOrigin(origin,appOrigin,production))return true;
 // Same-origin browser requests behind HTTPS proxies remain valid without
 // trusting forwarded host headers. Fetch Metadata is browser-controlled.
 if(site!=='same-origin')return false;
 const valid=originOf(origin);
 if(!valid)return false;
 const u=new URL(valid);
 return u.host===req.get('host')&&(!production||u.protocol==='https:');
}
function middleware(options){return (req,res,next)=>{
 if(!check(req,options))return res.status(403).json({success:false,error:'Origine de requête non autorisée'});
 next();
};}
module.exports={allowedOrigin,check,middleware};
