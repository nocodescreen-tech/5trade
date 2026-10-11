#!/usr/bin/env node
/**
 * 5trade — réinitialisation du mot de passe du compte unique.
 *
 * Usage :
 *   node reset-password.js                    → définit le mot de passe par défaut (5Trade2026)
 *   node reset-password.js MonMotDePasse2026  → définit le mot de passe choisi
 *   node reset-password.js --username rene --password MonMotDePasse2026
 *
 * Le mot de passe doit contenir au moins 8 caractères, une majuscule, une minuscule et un chiffre.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config();

const ACCOUNT_FILE = path.join(__dirname, '..', 'data', 'account.json');
const OTP_FILE = path.join(__dirname, '..', 'data', 'otp.json');
const SESSIONS_FILE = path.join(__dirname, '..', 'data', 'sessions.json');

const args = process.argv.slice(2);
const getFlag = (name) => {
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

const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');

let account = {};
try { account = JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf-8')); } catch {}

account = {
  id: 'owner',
  username,
  email: account.email || process.env.OWNER_EMAIL || 'no.codescreen@gmail.com',
  handle: account.handle || '@Nocodescreen667',
  role: 'owner',
  verified: true,
  salt,
  hash,
  createdAt: account.createdAt || new Date().toISOString(),
  passwordChangedAt: new Date().toISOString()
};

fs.mkdirSync(path.dirname(ACCOUNT_FILE), { recursive: true });
fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(account, null, 2));

// Purge des codes OTP et sessions en cours (l'ancien mot de passe ne doit plus rien ouvrir)
try { fs.unlinkSync(OTP_FILE); } catch {}
try { fs.unlinkSync(SESSIONS_FILE); } catch {}

console.log('✓ Mot de passe mis à jour');
console.log(`  utilisateur : ${account.username}`);
console.log(`  email       : ${account.email}`);
console.log(`  mot de passe: ${password}`);
console.log('  (codes OTP et sessions précédentes purgés — reconnectez-vous)');
