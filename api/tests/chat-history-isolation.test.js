'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('chat history isolates users, deletion and unassigned legacy records', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'5trade-chat-'));
  const file = path.join(dir,'history.json');
  process.env.CHAT_HISTORIQUE_FICHIER = file;
  const DB = require('../core/db');
  const original = DB.client;
  DB.client = () => null;
  try {
    fs.writeFileSync(file,JSON.stringify([{role:'user',texte:'legacy private'}]));
    const H = require('../chat-crud/historique');
    assert.equal((await H.enregistrer({utilisateur:'alice',role:'user',texte:'alice private'})).ok,true);
    assert.equal((await H.enregistrer({utilisateur:'bob',role:'assistant',texte:'bob private'})).ok,true);
    assert.deepEqual((await H.lister({utilisateur:'alice'})).map(m=>m.texte),['alice private']);
    assert.deepEqual((await H.lister({utilisateur:'bob'})).map(m=>m.texte),['bob private']);
    assert.deepEqual((await H.lister()).map(m=>m.texte),['legacy private']);
    assert.equal((await H.effacer({utilisateur:'alice'})).ok,true);
    assert.equal((await H.lister({utilisateur:'alice'})).length,0);
    assert.equal((await H.lister({utilisateur:'bob'})).length,1);
    assert.equal((await H.lister()).length,1);
    await assert.rejects(H.lister({utilisateur:''}),/Identité/);
  } finally {
    DB.client = original;
    delete process.env.CHAT_HISTORIQUE_FICHIER;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
