'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Parser = require('../chat-crud/parseur');
const Router = require('../chat-crud/routeur');
const Validator = require('../chat-crud/validateur');
const Skills = require('../chat-crud/commandes/skills');

test('skill commands route to skills rather than strategies or memory', async () => {
  for (const message of ['crée un skill calcul du pivot', 'active skill pivot_detector', 'désactive skill pivot_detector']) {
    const action = Parser.parser(message);
    assert.equal(action.type, 'skill');
    assert.equal(Router.router(action).domaine, 'skills');
    assert.equal(typeof Router.router(action).handler, 'function');
    assert.equal((await Validator.evaluer(action)).confirmation_requise, true);
  }
  for (const message of ['liste les skills','calcule skill pivot_detector {"h":10}']) {
    const action = Parser.parser(message);
    assert.equal(Router.router(action).domaine, 'skills');
    assert.equal((await Validator.evaluer(action)).confirmation_requise, false);
  }
});
test('skill generation refuses unconfirmed mutation without calling IA', async () => {
  const result = await Skills.creer('calcul du pivot', {utilisateur:'test',ia:()=>{throw new Error('must not call');}});
  assert.match(result.erreur,/Confirmation/);
});
test('skill generation rejects arbitrary model code and invalid specifications', async () => {
  for (const response of ['module.exports = {}', '{"specification":{},"tests":[]}']) {
    const result = await Skills.creer('calcul du pivot', {utilisateur:'test',confirmed:true,ia:async()=>response});
    assert.ok(result.erreur);
  }
});


test('legacy sandbox refuses arbitrary and apparently benign JavaScript',()=>{
 const S=require('../skills/sandbox');
 assert.equal(S.chargerDansSandbox('module.exports = {value:1}').ok,false);
 assert.throws(()=>S.creerContexteSecurise(),/désactivée/);
});
test('declarative skills reject unsupported operations and prototype output keys',()=>{
 const {compile}=require('../skills/declarative');
 const base={id:'test-calculator',nom:'Calcul test',description:'Calcul numérique borné',version:'1.0.0',actions:['calc']};
 assert.throws(()=>compile({...base,outputs:{calc:{result:{op:'exec',args:[1,2]}}}}));
 assert.throws(()=>compile({...base,outputs:{calc:JSON.parse('{"constructor":1}')}}));
 const skill=compile({...base,outputs:{calc:{result:{op:'div',args:[{input:'a'},{input:'b'}]}}}});
 assert.equal(skill.actif,false);
 assert.throws(()=>skill.executer({a:1,b:0}),/Division par zéro/);
 assert.deepEqual(skill.executer({a:8,b:2}),{result:4});
});
