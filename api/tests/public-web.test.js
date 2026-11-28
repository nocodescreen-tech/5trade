'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {Readable}=require('node:stream');
const W=require('../security/public-web');
test('public web rejects private and special-purpose destinations',()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','100.64.1.1','192.0.2.1','198.18.0.1','224.1.1.1','::1','::ffff:127.0.0.1'])assert.equal(W.publicV4(ip),false);
 for(const url of ['http://localhost','http://127.0.0.1','http://[::1]','http://example.com:8080','http://u:p@example.com'])assert.throws(()=>W.parse(url));
 assert.equal(W.publicV4('8.8.8.8'),true);
});
test('DNS is validated before any request including after a redirect',async()=>{
 let calls=0;
 const lookup=async host=>[{family:4,address:host==='example.com'?'8.8.8.8':'127.0.0.1'}];
 const request=async(u,ip)=>{calls++;assert.equal(ip,'8.8.8.8');const r=Readable.from([]);r.statusCode=302;r.headers={location:'https://other.example/'};return r;};
 await assert.rejects(W.readPage('https://example.com',{lookup,request}),/DNS/);
 assert.equal(calls,1);
 await assert.rejects(W.resolvePublic(W.parse('https://example.com'),async()=>[{family:4,address:'8.8.8.8'},{family:4,address:'10.0.0.1'}]),/DNS/);
});
test('streamed byte limit enforced without content-length',async()=>{
 await assert.rejects(W.readBounded(Readable.from([Buffer.alloc(4),Buffer.alloc(5)]),null,8),/volumineuse/);
 assert.equal((await W.readBounded(Readable.from(['ok']),null,8)).toString(),'ok');
});
