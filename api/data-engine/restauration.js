#!/usr/bin/env node
/**
 * Vérification d'une sauvegarde — « une sauvegarde non testée n'est pas une
 * sauvegarde ».
 *
 *   npm run restauration              (vérifie la dernière copie connue)
 *   npm run restauration -- --cle 5trade/backups/xxx.json.gz
 *
 * Ce script NE RESTAURE RIEN : il télécharge, décompresse, analyse et dit si la
 * copie est exploitable. Écrire dans la base est une décision humaine, pas une
 * conséquence d'un test.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const zlib = require('zlib');
const DB = require('../core/db');
const S3 = require('../core/s3');
const Backup = require('../delivery/backup');

/** Analyse pure : dit ce que contient la sauvegarde et ce qui manque. */
function verifierSauvegarde(obj) {
  const problemes = [];
  const infos = {};

  if (!obj || typeof obj !== 'object') {
    return { ok: false, problemes: ['contenu illisible : ce n\'est pas un objet JSON'], infos };
  }
  infos.version = obj.version || null;
  infos.mode = obj.mode || null;
  infos.at = obj.at || null;

  if (!obj.version) problemes.push('aucune version de format : impossible de savoir comment la relire');
  if (!infos.mode) problemes.push('aucun mode de stockage déclaré (fichiers ou postgresql)');

  if (infos.mode === 'postgresql') {
    // Le format réel est PLAT : { version, at, mode, kv: [...], strategies: [...],
    // trades: [...] }. On lit donc toute clé dont la valeur est une liste, plutôt
    // que de supposer un objet « tables » qui n'existe pas — c'est ce qui faisait
    // déclarer « aucune table » sur une sauvegarde parfaitement valide.
    const tables = (obj.tables && typeof obj.tables === 'object') ? obj.tables
      : Object.fromEntries(Object.entries(obj).filter(([k, v]) => Array.isArray(v)));
    // Une clé connue qui n'est pas une liste est une corruption, pas une absence :
    // le dire précisément évite de chercher le problème ailleurs.
    for (const cle of ['kv', 'strategies', 'trades']) {
      if (cle in obj && !Array.isArray(obj[cle])) {
        problemes.push(`clé « ${cle} » : le contenu n'est pas une liste`);
      }
    }
    infos.tables = {};
    let total = 0;
    for (const [nom, lignes] of Object.entries(tables)) {
      const n = Array.isArray(lignes) ? lignes.length : -1;
      infos.tables[nom] = n;
      if (n < 0) problemes.push(`table « ${nom} » : contenu n'est pas une liste`);
      else total += n;
    }
    infos.total = total;
    if (!Object.keys(tables).length) problemes.push('aucune table dans la sauvegarde');
    // Les tables vitales : sans elles, restaurer rendrait un compte vide.
    for (const vitale of ['kv']) {
      if (!(vitale in tables)) problemes.push(`table vitale « ${vitale} » absente`);
    }
  } else if (infos.mode === 'fichiers') {
    const fichiers = obj.fichiers || {};
    infos.fichiers = Object.keys(fichiers).length;
    if (!infos.fichiers) problemes.push('aucun fichier dans la sauvegarde');
    for (const [nom, contenu] of Object.entries(fichiers)) {
      if (typeof contenu !== 'string') { problemes.push(`fichier « ${nom} » : contenu non textuel`); break; }
      try { JSON.parse(contenu); } catch { problemes.push(`fichier « ${nom} » : JSON invalide`); break; }
    }
  } else {
    problemes.push(`mode inconnu « ${infos.mode} »`);
  }

  return { ok: problemes.length === 0, problemes, infos };
}

function options() {
  const a = process.argv.slice(2);
  const i = a.indexOf('--cle');
  return { cle: i >= 0 && a[i + 1] ? a[i + 1] : null };
}

async function cleLaPlusRecente() {
  try {
    const manifeste = await DB.kvLire('sauvegardes', []);
    if (Array.isArray(manifeste) && manifeste.length) return manifeste[manifeste.length - 1];
  } catch { /* manifeste absent : on retombe sur la clé du jour */ }
  return Backup.nomFichier();
}

async function principal() {
  const { cle } = options();
  await DB.init();

  if (!S3.s3Ready()) {
    console.log('R2 non configuré (S3_*) : aucune sauvegarde ne peut être vérifiée.');
    return { ok: false, raison: 'r2-absent' };
  }

  const cible = cle || await cleLaPlusRecente();
  console.log(`  copie vérifiée : ${cible}`);

  let corps;
  try {
    const d = S3.s3Sign('GET', cible, null);
    const r = await fetch(d.url, { headers: d.headers });
    if (!r.ok) {
      console.log(`  ÉCHEC : HTTP ${r.status} — la copie n'existe pas ou n'est pas accessible.`);
      return { ok: false, raison: 'http-' + r.status };
    }
    corps = Buffer.from(await r.arrayBuffer());
  } catch (e) {
    console.log(`  ÉCHEC : téléchargement impossible (${e.message.slice(0, 100)}).`);
    return { ok: false, raison: 'reseau' };
  }

  let json;
  try {
    const decompresse = cible.endsWith('.gz') ? zlib.gunzipSync(corps) : corps;
    json = JSON.parse(decompresse.toString('utf8'));
  } catch (e) {
    console.log(`  ÉCHEC : contenu illisible (${e.message.slice(0, 100)}).`);
    return { ok: false, raison: 'illisible' };
  }

  const v = verifierSauvegarde(json);
  console.log(`  ${Math.round(corps.length / 1024)} Ko compressés · mode ${v.infos.mode} · format v${v.infos.version}`);
  if (v.infos.tables) {
    for (const [nom, n] of Object.entries(v.infos.tables)) {
      console.log(`    ${nom.padEnd(16)} ${String(n).padStart(6)} ligne(s)`);
    }
    console.log(`    ${'total'.padEnd(16)} ${String(v.infos.total).padStart(6)} ligne(s)`);
  }
  if (v.infos.fichiers !== undefined) console.log(`    ${v.infos.fichiers} fichier(s)`);

  if (!v.ok) {
    console.log('\n  VERDICT : NON RESTAURABLE');
    v.problemes.forEach(p => console.log(`    - ${p}`));
    return { ok: false, problemes: v.problemes };
  }

  console.log('\n  VERDICT : RESTAURABLE (contenu cohérent, aucune écriture effectuée)');
  return { ok: true, infos: v.infos };
}

module.exports = { principal, verifierSauvegarde };

if (require.main === module) {
  principal().then(r => process.exit(r && r.ok ? 0 : 1)).catch(e => {
    console.error('ÉCHEC :', e.message);
    process.exit(1);
  });
}
