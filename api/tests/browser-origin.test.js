'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {allowed}=require('../security/browser-origin');
const r=(method,headers={},path='/strategies')=>({method,path,get:name=>headers[name]});
test('browser mutation rejects cross-site and malformed origins',()=>{
 assert.equal(allowed(r('POST',{Origin:'https://evil.example',Host:'trade.example','Sec-Fetch-Site':'cross-site'})),false);
 assert.equal(allowed(r('POST',{Origin:'null',Host:'trade.example'})),false);
 assert.equal(allowed(r('POST',{Origin:'https://other.example',Host:'trade.example'})),false);
 assert.equal(allowed(r('DELETE',{Origin:'https://trade.example',Host:'trade.example','Sec-Fetch-Site':'same-origin'})),true);
 assert.equal(allowed(r('POST',{Origin:'https://app.example',Host:'api.example'}),'https://app.example'),true);
 assert.equal(allowed(r('POST',{Host:'trade.example','Sec-Fetch-Site':'cross-site'})),false);
});
test('reads, CLI requests and exact Telegram webhook remain compatible',()=>{
 assert.equal(allowed(r('GET',{Origin:'https://other.example'})),true);
 assert.equal(allowed(r('POST')),true);
 assert.equal(allowed(r('POST',{'Sec-Fetch-Site':'cross-site'},'/alerts/telegram/webhook')),true);
 assert.equal(allowed(r('POST',{'Sec-Fetch-Site':'cross-site'},'/alerts/telegram/webhook/extra')),false);
});
test('frontend briefing renders React text, not injected HTML',()=>{
 const fs=require('node:fs'),path=require('node:path');
 for(const file of ['src/app.jsx','build/app.js']){
  const source=fs.readFileSync(path.join(__dirname,'../../frontend',file),'utf8');
  assert.ok(!source.includes('dangerouslySetInnerHTML'));
  assert.ok(source.includes("whiteSpace: 'pre-wrap'"));
 }
});
