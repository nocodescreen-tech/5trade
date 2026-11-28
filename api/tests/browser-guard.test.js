'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const G=require('../security/browser-guard');
const req=(method,headers={})=>({method,get:key=>headers[key]});
const opts={production:true,appOrigin:'https://terminal.example'};
test('cross-site browser mutations are blocked even with configured origin',()=>{
 assert.equal(G.check(req('POST',{origin:'https://evil.example','sec-fetch-site':'cross-site'}),opts),false);
 assert.equal(G.check(req('POST',{origin:'https://terminal.example','sec-fetch-site':'cross-site'}),opts),false);
 assert.equal(G.check(req('POST',{origin:'null'}),opts),false);
 assert.equal(G.check(req('POST',{origin:'http://localhost:3001'}),opts),false);
});
test('same origin and non-browser webhook requests remain supported',()=>{
 assert.equal(G.check(req('POST',{origin:'https://terminal.example'}),opts),true);
 assert.equal(G.check(req('POST',{origin:'https://host.example',host:'host.example','sec-fetch-site':'same-origin'}),opts),true);
 assert.equal(G.check(req('POST',{origin:'https://evil.example',host:'host.example','sec-fetch-site':'same-origin'}),opts),false);
 assert.equal(G.check(req('POST',{}),opts),true);
 assert.equal(G.check(req('GET',{origin:'https://evil.example'}),opts),true);
});
test('frontend briefing uses escaped React text rather than raw HTML',()=>{
 const fs=require('node:fs'),path=require('node:path');
 for(const file of ['src/app.jsx','build/app.js'])assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../../frontend',file),'utf8'),/dangerouslySetInnerHTML/);
});
