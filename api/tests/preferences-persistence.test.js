'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const DB = require('../core/db');
const Prefs = require('../memoire/preferences');

test('PostgreSQL rules are immediately visible to synchronous engine', async () => {
  const original = DB.client;
  let rows = [];
  let unavailable = false;
  const sql = async function(strings,...args) {
    if (typeof strings === 'string') return strings;
    if (unavailable) throw new Error('database unavailable');
    const q = strings.join(' ').trim();
    if (q.startsWith('select *')) return rows.map(r=>({...r}));
    if (q.startsWith('insert into')) {
      const [,cle,categorie,contenu,source] = args;
      rows = [{cle,categorie,contenu,source,active:true}];
    }
    if (q.startsWith('update')) {
      rows = rows.map(r=>({...r,active:false}));
      return rows;
    }
    return [];
  };
  DB.client = ()=>sql;
  try {
    assert.equal(await Prefs.init(), true);
    const r = await Prefs.enregistrer({cle:'gold-ban',contenu:'Interdire XAUUSD',categorie:'consigne'});
    assert.equal(r.ok,true);
    assert.equal(Prefs.obtenirContraintesActivesSync().symbolesInterdits.has('XAUUSD'),true);
    assert.equal((await Prefs.desactiver('gold-ban')).ok,true);
    assert.equal(Prefs.obtenirContraintesActivesSync().symbolesInterdits.size,0);
    unavailable = true;
    await assert.rejects(Prefs.lister(),/PostgreSQL/);
    assert.throws(()=>Prefs.obtenirContraintesActivesSync(),/non synchronisées/);
  } finally { DB.client = original; }
});
