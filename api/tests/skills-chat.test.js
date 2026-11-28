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
