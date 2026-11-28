'use strict';
const crypto=require('node:crypto');
const NAME='s5_challenge';
function parseCookies(raw){
  const out=Object.create(null);
  if(typeof raw!=='string')return out;
  for(const part of raw.split(';')){
    const i=part.indexOf('=');
    if(i<1)continue;
    const key=part.slice(0,i).trim();
    if(Object.hasOwn(out,key))continue;
    try{out[key]=decodeURIComponent(part.slice(i+1).trim());}catch{}
  }
  return out;
}
function create({ttlMs=1200000,max=256,now=Date.now}={}){
  const pending=new Map();
  const cookie=(res,value,age)=>res.append('Set-Cookie',NAME+'='+value+'; HttpOnly; SameSite=Strict; Path=/api; Max-Age='+age+(process.env.NODE_ENV==='production'||process.env.COOKIE_SECURE==='true'?'; Secure':''));
  const tokenOf=req=>parseCookies(req.headers?.cookie)[NAME];
  function issue(res,username,purpose){
    if(typeof username!=='string'||!['signup','login'].includes(purpose))throw Error('Challenge invalide');
    for(const [id,rec] of pending)if(rec.expires<=now()||rec.username===username)pending.delete(id);
    while(pending.size>=max)pending.delete(pending.keys().next().value);
    const token=crypto.randomBytes(32).toString('hex');
    pending.set(token,{username,purpose,expires:now()+ttlMs});
    cookie(res,token,Math.floor(ttlMs/1000));
    return token;
  }
  function check(req,username,purpose){
    const token=tokenOf(req);
    if(!token||!/^([a-f0-9]{64})$/.test(token))return null;
    const rec=pending.get(token);
    if(!rec||rec.expires<=now()||rec.username!==username||rec.purpose!==purpose)return null;
    return token;
  }
  function consume(token){
    const rec=pending.get(token);
    if(!rec||rec.expires<=now())return false;
    pending.delete(token);return true;
  }
  return {issue,check,consume,revoke:req=>pending.delete(tokenOf(req)),clear:res=>cookie(res,'',0)};
}
module.exports={parseCookies,create};
