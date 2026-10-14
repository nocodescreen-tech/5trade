#!/usr/bin/env node
/**
 * 5trade — définit / réinitialise le mot de passe du compte unique.
 *
 * Usage :
 *   node reset-password.js                       → mot de passe par défaut (5Trade2026)
 *   node reset-password.js MonMotDePasse2026     → mot de passe choisi
 *   node reset-password.js --username rene --password MonMotDePasse2026
 *
 * Le mot de passe doit contenir au moins 8 caractères, une majuscule,
 * une minuscule et un chiffre.
 *
 * IMPORTANT : passe par api/db.js. Le compte vit en PostgreSQL quand
 * DATABASE_URL est défini (repli JSON sinon) — écrire directement dans
 * data/account.json n'aurait aucun effet, l'application ne lit plus ce fichier.
 */
const crypto = require('crypto');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const DB = require('./db');

const args = process.argv.slice(2);
const getFlag = name => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : null;
};

const username = getFlag('username') || 'rene';
const positional = args.filter(a => !a.startsWith('--') && a !== getFlag('username'));
const password = getFlag('password') || positional[0] || '5Trade2026';

const issues = [];
if (password.length < 8) issues.push('au moins 8 caractères');
if (!/[A-Z]/.test(password)) issues.push('une majuscule');
if (!/[a-z]/.test(password)) issues.push('une minuscule');
if (!/[0-9]/.test(password)) issues.push('un chiffre');
if (issues.length) {
  console.error(`✗ Mot de passe trop faible : il faut ${issues.join(', ')}.`);
  process.exit(1);
}

(async () => {
  await DB.init();

  const previous = (await DB.getAccount()) || {};
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');

  const account = {
    id: 'owner',
    username,
    email: previous.email || process.env.OWNER_EMAIL || 'no.codescreen@gmail.com',
    handle: previous.handle || '@Nocodescreen667',
    role: 'owner',
    verified: true,
    salt,
    hash,
    createdAt: previous.createdAt || new Date().toISOString(),
    passwordChangedAt: new Date().toISOString()
  };

  await DB.saveAccount(account);

  // L'ancien mot de passe ne doit plus rien ouvrir : on purge les codes OTP
  // et les sessions. (Les sessions en mémoire du serveur tombent au redémarrage.)
  await DB.saveOtp({});
  await DB.saveSessions({});

  console.log('✓ Mot de passe mis à jour');
  console.log(`  stockage    : ${DB.isPg() ? 'PostgreSQL' : 'fichiers JSON (data/)'}`);
  console.log(`  utilisateur : ${account.username}`);
  console.log(`  email       : ${account.email}`);
  // Le mot de passe vient d'un argument (ou du defaut connu) : l'afficher
  // n'apprend rien a qui l'a tape. On le masque quand meme — une sortie
  // redirigee dans un fichier ne doit pas y laisser le secret en clair.
  const voile = password.length <= 4 ? '****'
    : password.slice(0, 2) + '*'.repeat(Math.max(3, password.length - 4)) + password.slice(-2);
  console.log(`  mot de passe: ${voile}  (${password.length} caracteres)`);
  console.log('  (codes OTP et sessions purgés — reconnectez-vous ; redémarrez le serveur)');

  if (DB.isPg && typeof DB.close === 'function') await DB.close();
  process.exit(0);
})().catch(e => {
  console.error('✗ Échec :', e.message);
  process.exit(1);
});
