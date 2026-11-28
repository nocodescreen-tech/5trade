'use strict';
const dns=require('node:dns/promises');
const net=require('node:net');
const http=require('node:http');
const https=require('node:https');
const MAX=2*1024*1024;
function publicV4(ip){
 if(net.isIP(ip)!==4)return false;
 const [a,b,c]=ip.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2||(b===88&&c===99)))||(a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
}
function parse(raw){
 if(typeof raw!=='string'||raw.length>2048)throw Error('URL invalide');
 let u;try{u=new URL(raw);}catch{throw Error('URL invalide');}
 const host=u.hostname.toLowerCase().replace(/\.$/,'');
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.internal')||host.endsWith('.local')||!host.includes('.')||(net.isIP(host)&&!publicV4(host)))throw Error('Destination web non autorisée');
 return u;
}
async function resolvePublic(u,lookup=dns.lookup){
 const host=u.hostname.replace(/\.$/,'');
 if(net.isIP(host)) {if(!publicV4(host))throw Error('Destination web non autorisée');return host;}
 const records=await lookup(host,{all:true,family:4});
 if(!Array.isArray(records)||!records.length||records.some(r=>r.family!==4||!publicV4(r.address)))throw Error('Destination DNS non autorisée');
 return records[0].address;
}
async function readBounded(stream,length,max=MAX){
 if(Number(length)>max){if(stream?.cancel)await stream.cancel().catch(()=>{});else stream?.destroy?.();throw Error('Réponse trop volumineuse');}
 if(!stream)throw Error('Réponse vide');
 const chunks=[];let n=0;
 try{for await(const chunk of stream){const buf=Buffer.from(chunk);n+=buf.length;if(n>max)throw Error('Réponse trop volumineuse');chunks.push(buf);}}
 catch(e){stream.destroy?.();throw e;}
 return Buffer.concat(chunks,n);
}
function requestPinned(u,ip,signal){
 return new Promise((resolve,reject)=>{
   const transport=u.protocol==='https:'?https:http;
   const req=transport.request(u,{method:'GET',agent:false,family:4,autoSelectFamily:false,signal,
    lookup:(host,opts,cb)=>opts?.all?cb(null,[{address:ip,family:4}]):cb(null,ip,4),
    headers:{'User-Agent':'5trade/1.0','Accept':'text/html,application/xhtml+xml,text/plain','Accept-Encoding':'identity'}},resolve);
   req.on('error',()=>reject(Error('Page web indisponible')));req.end();
 });
}
async function readPage(raw,{lookup=dns.lookup,request=requestPinned}={}){
 const signal=AbortSignal.timeout(20000);
 let target=parse(raw);
 for(let hop=0;hop<4;hop++){
   const ip=await new Promise((resolve,reject)=>{
     const abort=()=>reject(Error('Délai réseau dépassé'));
     if(signal.aborted)return abort();
     signal.addEventListener('abort',abort,{once:true});
     resolvePublic(target,lookup).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
   });
   if(signal.aborted)throw Error('Délai réseau dépassé');
   const res=await request(target,ip,signal);
   const status=res.statusCode;
   const headers=res.headers||{};
   if(status>=300&&status<400){res.destroy();if(!headers.location||hop===3)throw Error('Redirection refusée');target=parse(new URL(headers.location,target).toString());continue;}
   if(status<200||status>=300){res.destroy();throw Error('HTTP '+status);}
   if(headers['content-encoding']&&headers['content-encoding']!=='identity'){res.destroy();throw Error('Encodage web non pris en charge');}
   if(!/^(text\/html|application\/xhtml\+xml|text\/plain)(?:\s*;|$)/i.test(headers['content-type']||'')){res.destroy();throw Error('Type de contenu non autorisé');}
   return (await readBounded(res,headers['content-length'])).toString('utf8');
 }
 throw Error('Redirection refusée');
}
module.exports={publicV4,parse,resolvePublic,readBounded,readPage};
