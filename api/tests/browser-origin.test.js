'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {allowed,configuredOrigin}=require('../security/browser-origin');
const env={NODE_ENV:'production'},origin='https://terminal.example';
const r=(method,headers={})=>({method,protocol:'https',get:k=>headers[k]??(k==='Host'?'terminal.example':undefined)});
test('browser mutation rejects untrusted origins and supports authorized same origin and CLI',()=>{
 for(const h of [{Origin:'https://evil.example','Sec-Fetch-Site':'cross-site'},{Origin:'null'},{Origin:'http://terminal.example'},{Origin:'http://localhost:3000'},{'Sec-Fetch-Site':'cross-site'},{'Sec-Fetch-Site':'same-site'}])assert.equal(allowed(r('POST',h),origin,env),false);
 assert.equal(allowed(r('POST',{Origin:origin}),origin,env),true);
 assert.equal(allowed(r('POST'),origin,env),true);
 assert.equal(allowed(r('GET',{Origin:'https://evil.example'}),origin,env),true);
 assert.equal(configuredOrigin('http://localhost:3000',null,{NODE_ENV:'development'}),true);
 assert.equal(configuredOrigin('https://evil.example',null,{NODE_ENV:'production',CORS_LIBRE:'1'}),false);
});
test('frontend briefing is escaped React text and Telegram values are escaped',()=>{
 const fs=require('node:fs'),path=require('node:path');
 for(const name of ['src/app.jsx','build/app.js']){
 const source=fs.readFileSync(path.join(__dirname,'../../frontend',name),'utf8');
 assert.ok(!source.includes('dangerouslySetInnerHTML'));assert.ok(source.includes("whiteSpace: 'pre-wrap'"));}
 const {escapeHtml}=require('../routes/alerts');
 assert.equal(escapeHtml('<b>test & "x"</b>'),'&lt;b&gt;test &amp; &quot;x&quot;&lt;/b&gt;');
});
