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

  // Diagnostic honnête : une fiche n'est exécutable que si elle déclare marché,
  // conditions obligatoires et unité de temps. Les autres restent documentaires.
  const Diagnostic = require('./fiches');
  const executables = [];
  const documentaires = [];
  const incompletes = [];
  for (const doc of docs) {
    const d = Diagnostic.diagnostic(doc);
    if (d.executable) executables.push({ doc, complement: d.complement });
    else if (!doc.moteur) documentaires.push(doc);
    else incompletes.push({ id: doc.id, manques: d.manques });
  }

  const rapport = await Registry.synchroniser(executables.map(e => e.doc), { etat });
  console.log(`registre : ${rapport.enregistrees} fiche(s) enregistrée(s), ` +
    `${rapport.identiques} déjà identique(s), ${rapport.refusees.length} refusée(s) — état « ${etat} »`);
  console.log(`           ${executables.length} exécutable(s) · ${documentaires.length} documentaire(s) ` +
    `· ${incompletes.length} incomplète(s)`);
  for (const r of rapport.refusees) {
    console.log(`  refusée ${r.id} : ${r.raison}${r.erreurs ? ' — ' + r.erreurs.join(' ; ') : ''}`);
  }
  for (const [id, avert] of Object.entries(rapport.avertissements)) {
    console.log(`  ${id} : ${avert.join(' ; ')}`);
  }
  for (const i of incompletes) {
    console.log(`  incomplète ${i.id} : ${i.manques.join(' ; ')}`);
  }
  return { ...rapport, executables: executables.length, documentaires: documentaires.length, incompletes: incompletes.length };
}

module.exports = { principal };

if (require.main === module) {
  principal().then(() => process.exit(0)).catch(e => {
    console.error('ÉCHEC :', e.message);
    process.exit(1);
  });
}
