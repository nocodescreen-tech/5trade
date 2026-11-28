'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { validerFicheDescription } = require('../core/knowledge-description');
const valid = {titre:'Sweep Deriv',resume:'Balayage puis retour',regles:['R1'],filtres:['volatilite'],style:'scalping',timeframes:['1m','5m'],seuilAlignes:2,seuilForce:0.5,entree:'Clôture de reprise',invalidation:'Derrière la mèche',objectif:'POC puis borne opposée',contexte:null,concepts:['Sweep'],motsCles:['Deriv']};
const raw = JSON.stringify(valid);
test('accepts complete strategy, including fenced JSON', () => {
  assert.deepEqual(JSON.parse(validerFicheDescription(raw)), valid);
  assert.deepEqual(JSON.parse(validerFicheDescription('\x60\x60\x60json\n'+raw+'\n\x60\x60\x60')), valid);
});
test('rejects incomplete, truncated or unsupported trading rules', () => {
  for(const input of ['<!DOCTYPE html>',raw.slice(0,-1),'null','[]',JSON.stringify({...valid,regles:[]}),JSON.stringify({...valid,regles:['R5']}),JSON.stringify({...valid,objectif:undefined}),JSON.stringify({...valid,seuilForce:10})]) {
    assert.throws(()=>validerFicheDescription(input));
  }
});
const server = fs.readFileSync(require.resolve('../server.js'),'utf8');
const code = server.slice(server.indexOf("let dernierFournisseur ="),server.indexOf('// ─────────────────────────────────────────────────────────────\n// Sessions'));
function cascade({nvidia,gemini,models=['a','b']}) {
  const context={process:{env:{NVIDIA_API_KEY:'test',GEMINI_API_KEY:'test'}},NVIDIA_MODELS:models,NVIDIA_BUDGET_TOTAL_MS:50000,AbortSignal,console:{log(){},warn(){}},Couts:{enregistrer(){}},appelNvidia:nvidia,appelGeminiTexte:gemini};
  return vm.runInNewContext(code+'\nanalyserIA',context);
}
test('invalid JSON from first provider triggers fallback',async()=>{
  const calls=[];
  const run=cascade({nvidia:async(m)=>{calls.push(m);return {contenu:m==='a'?'not json':raw,modele:m,usage:{}}},gemini:async()=>{throw Error('unexpected')}});
  assert.deepEqual(JSON.parse(await run([],{json:true,valider:validerFicheDescription,deadline:Date.now()+20000})),valid);
  assert.deepEqual(calls,['a','b']);
});
test('reserve remaining deadline for Gemini and validate its response',async()=>{
  let called=0;
  const run=cascade({nvidia:async()=>{throw Error('unexpected')},gemini:async(_messages,opts)=>{called++;assert.ok(opts.signal);return raw;}});
  assert.deepEqual(JSON.parse(await run([],{json:true,valider:validerFicheDescription,deadline:Date.now()+6000})),valid);
  assert.equal(called,1);
});
test('expired deadline does not call either provider',async()=>{
  let called=0;const f=async()=>{called++;return raw;};
  const run=cascade({nvidia:f,gemini:f});
  await assert.rejects(run([],{json:true,valider:validerFicheDescription,deadline:Date.now()-1}),e=>e.status===503);
  assert.equal(called,0);
});

test('knowledge uses chat NVIDIA model chain and never calls Gemini',async()=>{
  for (const route of ['description-strategie','structuration-web']) {
    const calls=[];
    const run=cascade({nvidia:async(m)=>{calls.push(m);throw Error('unavailable')},gemini:async()=>{calls.push('gemini');return raw;}});
    await assert.rejects(run([],{route,json:true,valider:validerFicheDescription,deadline:Date.now()+20000}),e=>e.status===503);
    assert.deepEqual(calls,['a','b']);
  }
});
test('knowledge has full NVIDIA budget even if Gemini key is configured',async()=>{
  const calls=[];
  const run=cascade({nvidia:async(m)=>{calls.push(m);return {contenu:raw,modele:m,usage:{}}},gemini:async()=>{throw Error('unexpected Gemini')}});
  assert.deepEqual(JSON.parse(await run([],{route:'description-strategie',json:true,valider:validerFicheDescription,deadline:Date.now()+6000})),valid);
  assert.deepEqual(calls,['a']);
});
