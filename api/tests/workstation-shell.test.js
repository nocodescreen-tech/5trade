'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../../frontend');
test('served terminal bundle parses and contains all workstation routes',()=>{
 const source=fs.readFileSync(path.join(root,'src/app.jsx'),'utf8');
 const bundle=fs.readFileSync(path.join(root,'build/app.js'),'utf8');
 new vm.Script(bundle);
 for(const text of [source,bundle]){
   assert.match(text,/function WorkstationNav\(/);
   assert.match(text,/function WorkstationMetrics\(/);
   for(const id of ['live','analyze','pilote','add','strategies','journal','history','termes','news','alerts','outils','systeme']){
     assert.ok(new RegExp("tab\\s*===\\s*['\"]"+id+"['\"]").test(text),id);
   }
 }
 const css=fs.readFileSync(path.join(root,'terminal.css'),'utf8');
 assert.match(css,/\.workspace-sidebar\s*\{[^}]*position:fixed/);
 assert.match(css,/\.workspace-sidebar\s*\{\s*display:none/);
});
