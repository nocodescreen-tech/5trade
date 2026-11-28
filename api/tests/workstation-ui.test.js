'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../../frontend');
const ids=['live','analyze','strategies','journal','news','pilote','add','history','termes','alerts','outils','systeme'];
const nav=ids.map(id=>({id,label:id,icon:'fa-circle'}));
const h=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)});
function walk(node,fn){if(node&&typeof node==='object'){fn(node);for(const child of node.children||[])walk(child,fn);}}
for(const file of ['src/app.jsx','build/app.js']){
 const src=fs.readFileSync(path.join(root,file),'utf8');
 const chrome=src.slice(src.indexOf('function WorkstationChrome('),src.indexOf('function Dashboard('));
 const ctx={React:{createElement:h,Fragment:'fragment'},useState:v=>[v,()=>{}],useRef:()=>({current:null}),useEffect:()=>{},ttFmt:v=>v==null?'—':String(v),ttHeure:String};
 const ui=vm.runInNewContext(chrome+'\n({WorkstationChrome,WorkstationMetrics})',ctx);
 test(file+' workstation navigation covers every existing page',()=>{
  const chosen=[];
  const view=ui.WorkstationChrome({nav,tab:'live',choose:id=>chosen.push(id),drawer:false,setDrawer:()=>{},user:{username:'test'},logout:()=>{},openBroker:()=>{},toggleMute:()=>{},shortcuts:()=>{}});
  const links=[];walk(view,n=>{if((n.props.className||'').startsWith('ws-nav-link'))links.push(n)});
  assert.equal(links.length,ids.length);
  for(const link of links)link.props.onClick();
  assert.deepEqual(chosen,ids);
  assert.equal(links.filter(n=>n.props['aria-current']==='page').length,1);
 });
 test(file+' workstation metrics do not fabricate unavailable values',()=>{
  const view=ui.WorkstationMetrics({actifs:[],symbol:'frxXAUUSD',price:null,decision:null,live:false,offline:false});
  const values=[];walk(view,n=>{if(n.type==='strong')values.push(n.children[0])});
  assert.deepEqual(values,[0,'XAUUSD','—','—','En attente','En attente']);
 });
}
test('served frontend bundle is valid JavaScript',()=>{new vm.Script(fs.readFileSync(path.join(root,'build/app.js'),'utf8'));});
test('sidebar is fixed and responsive',()=>{
 const css=fs.readFileSync(path.join(root,'terminal.css'),'utf8');
 assert.match(css,/\.ws-shell \.ws-sidebar\{position:fixed/);
 assert.match(css,/\.ws-sidebar\.is-open\{display:flex\}/);
});
