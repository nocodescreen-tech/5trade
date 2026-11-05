#!/usr/bin/env node
/**
 * Synchronise le registre des fiches de stratégie (schéma phase 2).
 *
 *   npm run registre                      enregistre les stratégies exécutables (brouillon)
 *   npm run registre -- --etat validee    marque les fiches comme validées
 *
 * Ne touche à rien d'autre : une version déjà enregistrée avec un contenu différent
 * est REFUSÉE (une version publiée est immuable, on en publie une nouvelle).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const DB = require('../core/db');
const Registry = require('./registry');

async function principal() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--etat');
  const etat = i >= 0 && args[i + 1] ? args[i + 1] : 'brouillon';

  await DB.init();
  if (!DB.isPg()) {
    console.log('Stockage fichiers : le registre exige PostgreSQL (schéma phase 2). Rien à faire.');
    return { disponible: false };
  }
  const list = await DB.listStrategies();
  const docs = (list || []).map(x => (x.id ? { id: x.id, ...x } : x));

  const rapport = await Registry.synchroniser(docs, { etat });
  console.log(`registre : ${rapport.enregistrees} fiche(s) enregistrée(s), ` +
    `${rapport.identiques} déjà identique(s), ${rapport.refusees.length} refusée(s) — état « ${etat} »`);
  for (const r of rapport.refusees) {
    console.log(`  refusée ${r.id} : ${r.raison}${r.erreurs ? ' — ' + r.erreurs.join(' ; ') : ''}`);
  }
  for (const [id, avert] of Object.entries(rapport.avertissements)) {
    console.log(`  ${id} : ${avert.join(' ; ')}`);
  }
  return rapport;
}

module.exports = { principal };

if (require.main === module) {
  principal().then(() => process.exit(0)).catch(e => {
    console.error('ÉCHEC :', e.message);
    process.exit(1);
  });
}
