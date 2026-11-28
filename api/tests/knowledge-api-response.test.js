'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../../frontend');
for (const file of ['src/app.jsx','build/app.js']) {
  const code=fs.readFileSync(path.join(root,file),'utf8');
  const source=code.slice(code.indexOf('async function lireJsonApi('),code.indexOf('const REDUCED'));
  const parse=vm.runInNewContext(source+'\nlireJsonApi');
  test(file+' parses strategy API responses without external globals',async()=>{
    assert.equal((await parse(new Response(JSON.stringify({success:true,strategy:{title:'SMC'}}),{headers:{'content-type':'application/json'}}))).strategy.title,'SMC');
    await assert.rejects(parse(new Response('<!doctype html>',{status:200,headers:{'content-type':'text/html'}})),/non JSON/);
    await assert.rejects(parse(new Response('oops',{headers:{'content-type':'application/json'}})),/JSON invalide/);
    await assert.rejects(parse(new Response(JSON.stringify({error:'Session expirée'}),{status:401,headers:{'content-type':'application/json'}})),/Session expirée/);
    await assert.rejects(parse(new Response(JSON.stringify({success:false,error:'IA indisponible'}),{headers:{'content-type':'application/json'}})),/IA indisponible/);
    assert.ok(!code.includes('window.FiveTradeApiResponse'));
  });
}
test('index does not request missing response helper',()=>{
  assert.ok(!fs.readFileSync(path.join(root,'index.html'),'utf8').includes('api-response.js'));
});
