/**
 * 5trade — Plateforme de trading IA
 * Backend Node.js / Express
 *
 * Systèmes d'ajout de connaissance (combinés, tous actifs) :
 *   1. upload   → PDF / DOCX / TXT / MD
 *   2. manual   → saisie directe (titre + contenu)
 *   3. url      → scraping d'une page web précise
 *   4. search   → recherche web autonome + scraping + sauvegarde
 *   5. forums   → sources connues (forexfactory, tradingview, reddit, babypips)
 *
 * Analyse : DeepSeek multimodal (jusqu'à 4 captures TradingView multi-timeframes)
 * puis recherche dans la base + combinaison de 2-3 stratégies → plan d'action.
 */

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const DB = require('./db');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config(); // fallback si .env présent dans api/

const app = express();
const PORT = process.env.PORT || 3001;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

// ─────────────────────────────────────────────────────────────
// Chemins
// ─────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const KNOWLEDGE_BASE_DIR = path.join(ROOT, 'knowledge-base');
const DOCUMENTS_DIR = path.join(KNOWLEDGE_BASE_DIR, 'documents');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const ACCOUNT_FILE = path.join(DATA_DIR, 'account.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

// ─────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
// Frontend servi sur la même origine (évite les soucis de CORS)
app.use(express.static(path.join(ROOT, 'frontend')));

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// ─────────────────────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────────────────────
async function ensureDirs() {
  for (const d of [KNOWLEDGE_BASE_DIR, DOCUMENTS_DIR, UPLOADS_DIR, DATA_DIR]) {
    await fs.mkdir(d, { recursive: true });
  }
}

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, s, 64).toString('hex');
  return { salt: s, hash };
}

function verifyPassword(password, salt, hash) {
  const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(hash));
}

function newId(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function extractTags(text) {
  const keywords = [
    'bullish', 'bearish', 'breakout', 'breakdown', 'reversal', 'support',
    'resistance', 'trend', 'pattern', 'risk', 'management', 'liquidity',
    'order block', 'fvg', 'imbalance', 'fair value gap', 'supply', 'demand',
    'killzone', 'session', 'london', 'new york', 'asia', 'structure',
    'choch', 'bos', 'engulfing', 'pin bar', 'doji', 'fibonacci', 'retracement',
    'scalp', 'swing', 'xauusd', 'eurusd', 'gbpusd', 'volatility', 'news'
  ];
  const lower = (text || '').toLowerCase();
  return keywords.filter(k => lower.includes(k));
}

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

async function writeJSON(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function loadAllStrategies() {
  const list = await DB.listStrategies();
  return (list || []).sort((a, b) =>
    new Date(b.createdAt || b.uploadDate || 0) - new Date(a.createdAt || a.uploadDate || 0));
}

// ─────────────────────────────────────────────────────────────
// STOCKAGE DISTANT
//   • Cloudinary → captures de graphiques (issu de hubcommerce)
//   • S3         → base de connaissance & stratégies (issu de schoolflow)
//   • ImageKit   → repli si S3 non configuré (schoolflow utilise ImageKit)
//   • local      → dernier repli, toujours actif
// ─────────────────────────────────────────────────────────────
let cld = null;
const cloudReady = () =>
  !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

function getCloudinary() {
  if (cld) return cld;
  const { v2 } = require('cloudinary');
  v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
  cld = v2;
  return cld;
}

function uploadToCloudinary(filePath, folder) {
  return new Promise((resolve, reject) => {
    getCloudinary().uploader.upload(
      filePath,
      { folder: folder || process.env.CLOUDINARY_FOLDER || '5trade/charts', resource_type: 'image' },
      (err, res) => (err ? reject(err) : resolve(res))
    );
  });
}

// ─── ImageKit (REST, sans dépendance) ───
const imagekitReady = () =>
  !!(process.env.IMAGEKIT_PRIVATE_KEY && process.env.IMAGEKIT_URL_ENDPOINT);

async function uploadToImageKit(buffer, fileName, folder) {
  const fd = new FormData();
  fd.append('file', new Blob([buffer]), fileName);
  fd.append('fileName', fileName);
  if (folder) fd.append('folder', folder);
  const auth = Buffer.from(`${process.env.IMAGEKIT_PRIVATE_KEY}:`).toString('base64');
  const res = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
    body: fd
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d.message || `ImageKit HTTP ${res.status}`);
  return d;
}

// ─── S3 (Cloudflare R2) — implémentation dans s3.js ───
const S3 = require('./s3');

// ─── Vision (Gemini) — implémentation dans vision.js ───
const vision = require('./vision');

// ─── Journal de trades — logique dans trades.js ───
const Trades = require('./trades');

/** Miroir distant d'un artefact de la base : S3 → ImageKit → local */
async function mirrorRemote(relPath, buffer, contentType) {
  const clean = String(relPath).replace(/\\/g, '/');
  try {
    if (S3.s3Ready()) {
      const key = (process.env.S3_PREFIX || '5trade/') + clean;
      return { provider: 's3', url: await S3.uploadToS3(buffer, key, contentType) };
    }
    if (imagekitReady()) {
      const d = await uploadToImageKit(buffer, clean.split('/').pop(), '5trade/knowledge');
      return { provider: 'imagekit', url: d.url };
    }
  } catch (e) {
    console.error('mirrorRemote:', e.message);
  }
  return { provider: 'local', url: null };
}

function storageStatus() {
  return {
    cloudinary: cloudReady(),
    s3: S3.s3Ready(),
    imagekit: imagekitReady(),
    fallback: 'local'
  };
}

async function saveStrategy(strategy) {
  // Base de données (PostgreSQL ou JSON via DB)
  await DB.saveStrategyRecord(strategy);

  // Copie locale lisible (knowledge-base/*.json) pour inspection directe
  const filePath = path.join(KNOWLEDGE_BASE_DIR, `${strategy.id}.json`);
  const payload = JSON.stringify(strategy, null, 2);
  try {
    await fs.mkdir(KNOWLEDGE_BASE_DIR, { recursive: true });
    await fs.writeFile(filePath, payload);
  } catch (e) { /* disque secondaire, on ignore */ }

  // Miroir distant (S3 → ImageKit) sans bloquer la réponse, mais erreurs VISIBLES
  mirrorRemote(`strategies/${strategy.id}.json`, Buffer.from(payload), 'application/json')
    .then(r => {
      if (r.url) {
        strategy.remoteUrl = r.url;
        console.log(`   Miroir ${r.provider} : strategies/${strategy.id}.json`);
      }
    })
    .catch(e => console.error('   Miroir distant ÉCHEC :', e.message));

  return strategy;
}

async function appendHistory(entry) {
  const history = await DB.loadHistory();
  history.unshift(entry);
  await DB.saveHistory(history.slice(0, 200));
}

// ─────────────────────────────────────────────────────────────
// DeepSeek
// ─────────────────────────────────────────────────────────────
async function deepseek(messages, { maxTokens = 2000, json = false } = {}) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || key.includes('your_deepseek')) {
    throw new Error('DEEPSEEK_API_KEY non configurée dans .env');
  }
  const body = {
    model: DEEPSEEK_MODEL,
    messages,
    max_tokens: maxTokens,
    temperature: 0.3
  };
  if (json) body.response_format = { type: 'json_object' };

  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `DeepSeek HTTP ${res.status}`);
  }
  return data.choices[0].message.content;
}

// ─────────────────────────────────────────────────────────────
// Sessions (cookie httpOnly — invisibles dans DevTools)
// ─────────────────────────────────────────────────────────────
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 jours
let sessions = {};          // token → { username, expires }
const loginAttempts = {};   // ip → { count, until }

async function loadSessions() {
  sessions = await DB.loadSessions();
  const now = Date.now();
  for (const [t, s] of Object.entries(sessions)) {
    if (!s.expires || s.expires < now) delete sessions[t];
  }
}
async function saveSessions() { await DB.saveSessions(sessions); }

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { username, expires: Date.now() + SESSION_TTL_MS };
  saveSessions();
  return token;
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `s5_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 's5_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
}

function getSession(req) {
  const token = parseCookies(req).s5_session;
  if (!token) return null;
  const s = sessions[token];
  if (!s) return null;
  if (s.expires < Date.now()) { delete sessions[token]; saveSessions(); return null; }
  return { token, ...s };
}

// Middleware : routes protégées
function requireAuth(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Non authentifié' });
  req.session = s;
  next();
}

// Anti brute-force : 8 essais / 10 min par IP en prod (plus permissif en dev)
function rateLimitLogin(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'x';
  const now = Date.now();
  const LIMIT = process.env.NODE_ENV === 'production' ? 8 : 100;
  const a = loginAttempts[ip] || { count: 0, until: 0 };
  if (a.until > now && a.count >= LIMIT) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
  }
  if (a.until < now) { a.count = 0; a.until = now + 10 * 60 * 1000; }
  a.count++;
  loginAttempts[ip] = a;
  next();
}

// ─────────────────────────────────────────────────────────────
// EMAIL (nodemailer) — envoi des codes OTP
// ─────────────────────────────────────────────────────────────
let mailer = null;
function getMailer() {
  if (mailer) return mailer;
  const nodemailer = require('nodemailer');
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE) === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 15000
  });
  return mailer;
}

async function sendMail({ to, subject, html }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  return getMailer().sendMail({ from, to, subject, html });
}

function maskEmail(e) {
  const [u, d] = String(e).split('@');
  if (!d) return '***';
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(u.length - 2, 2))}@${d}`;
}

// ─────────────────────────────────────────────────────────────
// OTP — code à 6 chiffres, haché, à usage unique, anti-bruteforce
// ─────────────────────────────────────────────────────────────
const OTP_FILE = path.join(DATA_DIR, 'otp.json');
const OTP_TTL_MS = Number(process.env.OTP_TTL_MINUTES || 10) * 60 * 1000;
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_SENDS_PER_HOUR = 5;

function otpHash(code, salt) {
  return crypto.createHash('sha256').update(`${code}:${salt}`).digest('hex');
}

function httpError(message, status) {
  const e = new Error(message);
  e.status = status || 400;
  return e;
}

async function issueOtp(username, purpose, { enforceCooldown = true } = {}) {
  const store = await DB.loadOtp();
  const now = Date.now();
  const rec = store[username] || { sends: [] };
  rec.sends = (rec.sends || []).filter(t => now - t < 3600_000);

  if (enforceCooldown && rec.sends.length) {
    const last = rec.sends[rec.sends.length - 1];
    if (now - last < OTP_RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - last)) / 1000);
      throw httpError(`Veuillez patienter ${wait}s avant de demander un nouveau code.`, 429);
    }
  }
  if (rec.sends.length >= OTP_MAX_SENDS_PER_HOUR) {
    throw httpError('Trop de codes demandés. Réessayez dans une heure.', 429);
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const salt = crypto.randomBytes(16).toString('hex');
  store[username] = {
    purpose,
    hash: otpHash(code, salt),
    salt,
    expires: now + OTP_TTL_MS,
    attempts: 0,
    sends: [...rec.sends, now],
    createdAt: now
  };
  await DB.saveOtp(store);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DEV] OTP ${purpose} pour ${username} : ${code}`);
  }
  return code;
}

async function verifyOtp(username, code, purpose) {
  if (!/^\d{6}$/.test(String(code || ''))) throw httpError('Le code doit contenir 6 chiffres.', 400);

  const store = await DB.loadOtp();
  const rec = store[username];
  if (!rec) throw httpError('Aucun code en attente. Demandez un nouveau code.', 400);
  if (rec.purpose !== purpose) throw httpError('Code invalide pour cette action.', 400);

  if (rec.expires < Date.now()) {
    delete store[username]; await DB.saveOtp(store);
    throw httpError('Code expiré. Demandez un nouveau code.', 400);
  }
  if (rec.attempts >= OTP_MAX_ATTEMPTS) {
    delete store[username]; await DB.saveOtp(store);
    throw httpError('Trop de tentatives. Demandez un nouveau code.', 429);
  }

  const ok = crypto.timingSafeEqual(
    Buffer.from(otpHash(String(code), rec.salt)),
    Buffer.from(rec.hash)
  );
  if (!ok) {
    rec.attempts++;
    await DB.saveOtp(store);
    throw httpError(`Code incorrect (${OTP_MAX_ATTEMPTS - rec.attempts} essai(s) restant(s)).`, 401);
  }

  delete store[username]; // usage unique
  await DB.saveOtp(store);
  return true;
}

function otpEmailHtml(code, purpose) {
  const title = purpose === 'signup' ? 'Confirmez votre inscription' : 'Validation de connexion';
  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:auto;background:#0b0e14;color:#e6edf3;padding:28px;border-radius:14px">
  <h2 style="margin:0 0 4px"><span style="color:#2563eb">5</span>trade</h2>
  <p style="color:#8b98a8;font-size:14px;margin:4px 0 0">${title}</p>
  <div style="font-size:34px;font-weight:800;letter-spacing:8px;background:#111722;padding:18px;border-radius:10px;text-align:center;margin:18px 0;color:#fff">${code}</div>
  <p style="font-size:13px;color:#8b98a8;margin:0">Valable ${Math.round(OTP_TTL_MS / 60000)} minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
</div>`;
}

async function sendOtpEmail(account, code, purpose) {
  await sendMail({
    to: account.email,
    subject: `5trade — votre code ${purpose === 'signup' ? "d'inscription" : 'de connexion'}`,
    html: otpEmailHtml(code, purpose)
  });
}

// ─── Validation d'entrée robuste ───
function validateUsername(u) {
  if (!u || !/^[A-Za-z0-9_.-]{3,32}$/.test(u)) {
    return "Nom d'utilisateur invalide (3-32 caractères : lettres, chiffres, . _ -)";
  }
  return null;
}
function validateEmail(e) {
  if (!e) return null; // email optionnel -> celui du propriétaire
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return 'Adresse email invalide';
  if (e.length > 254) return 'Adresse email trop longue';
  return null;
}
function passwordIssues(p) {
  const out = [];
  if (!p || p.length < 8) out.push('au moins 8 caractères');
  if (!/[A-Z]/.test(p || '')) out.push('une majuscule');
  if (!/[a-z]/.test(p || '')) out.push('une minuscule');
  if (!/[0-9]/.test(p || '')) out.push('un chiffre');
  return out;
}

// ─────────────────────────────────────────────────────────────
// Authentification — inscription + connexion (compte unique en prod)
// ─────────────────────────────────────────────────────────────
const OWNER_EMAIL = 'no.codescreen@gmail.com';
const OWNER_HANDLE = '@Nocodescreen667';

app.post('/api/signup', rateLimitLogin, async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // ─── Validation robuste ───
    const uErr = validateUsername(username);
    if (uErr) return res.status(400).json({ error: uErr });
    const eErr = validateEmail(email);
    if (eErr) return res.status(400).json({ error: eErr });
    const pIssues = passwordIssues(password);
    if (pIssues.length) {
      return res.status(400).json({ error: 'Mot de passe trop faible : il faut ' + pIssues.join(', ') + '.' });
    }

    const existingAccount = await DB.getAccount();

    // Un seul compte : refus si un compte VÉRIFIÉ existe déjà
    if (existingAccount && existingAccount.verified) {
      return res.status(409).json({ error: 'Une inscription est déjà enregistrée pour cette plateforme.' });
    }

    const { salt, hash } = hashPassword(password);
    const account = {
      id: 'owner',
      username,
      email: email || OWNER_EMAIL,
      handle: OWNER_HANDLE,
      salt,
      hash,
      role: 'owner',
      verified: false,
      createdAt: new Date().toISOString()
    };
    await DB.saveAccount(account);

    // Envoi du code OTP
    const code = await issueOtp(account.username, 'signup', { enforceCooldown: false });
    try {
      await sendOtpEmail(account, code, 'signup');
    } catch (mailErr) {
      console.error('Erreur envoi OTP:', mailErr.message);
      return res.status(502).json({
        error: "Impossible d'envoyer l'email de vérification. Vérifiez la configuration SMTP.",
        otpRequired: true,
        purpose: 'signup',
        email: maskEmail(account.email)
      });
    }

    res.json({
      success: true,
      otpRequired: true,
      purpose: 'signup',
      email: maskEmail(account.email),
      message: 'Un code à 6 chiffres a été envoyé par email.'
    });
  } catch (error) {
    console.error('Erreur signup:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

// ─── Étape OTP : valide le code et ouvre la session ───
app.post('/api/verify-otp', rateLimitLogin, async (req, res) => {
  try {
    const { username, code, purpose } = req.body;
    if (!username || !code || !purpose) {
      return res.status(400).json({ error: 'Données incomplètes' });
    }
    const account = await DB.getAccount();
    if (!account || account.username !== username) {
      return res.status(404).json({ error: 'Compte introuvable' });
    }

    await verifyOtp(username, code, purpose);

    if (purpose === 'signup') {
      account.verified = true;
      account.verifiedAt = new Date().toISOString();
      await DB.saveAccount(account);
    }

    const token = createSession(account.username);
    setSessionCookie(res, token);

    res.json({
      success: true,
      user: { username: account.username, email: account.email, handle: account.handle }
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// ─── Renvoyer un code OTP (cooldown 60 s, max 5/h) ───
app.post('/api/resend-otp', rateLimitLogin, async (req, res) => {
  try {
    const { username, purpose } = req.body;
    const account = await DB.getAccount();
    if (!account || account.username !== username) {
      return res.status(404).json({ error: 'Compte introuvable' });
    }
    const code = await issueOtp(username, purpose);
    await sendOtpEmail(account, code, purpose);
    res.json({ success: true, email: maskEmail(account.email), message: 'Nouveau code envoyé.' });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post('/api/login', rateLimitLogin, async (req, res) => {
  try {
    const { username, password } = req.body;
    const account = await DB.getAccount();
    if (!account) {
      return res.status(404).json({ error: 'Aucun compte. Inscrivez-vous d\'abord.' });
    }
    const okUser = username === account.username || username === account.email;
    if (!okUser || !verifyPassword(password, account.salt, account.hash)) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    // Compte non vérifié → renvoyer un code d'inscription
    const purpose = account.verified === false ? 'signup' : 'login';

    // 2FA à la connexion
    if (account.verified !== false && String(process.env.OTP_ON_LOGIN) !== 'true') {
      const token = createSession(account.username);
      setSessionCookie(res, token);
      return res.json({
        success: true,
        user: { username: account.username, email: account.email, handle: account.handle }
      });
    }

    const code = await issueOtp(account.username, purpose);
    try {
      await sendOtpEmail(account, code, purpose);
    } catch (mailErr) {
      console.error('Erreur envoi OTP:', mailErr.message);
      return res.status(502).json({ error: "Impossible d'envoyer le code par email." });
    }

    res.json({
      success: true,
      otpRequired: true,
      purpose,
      email: maskEmail(account.email),
      message: 'Un code à 6 chiffres a été envoyé par email.'
    });
  } catch (error) {
    console.error('Erreur login:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post('/api/logout', (req, res) => {
  const s = getSession(req);
  if (s) { delete sessions[s.token]; saveSessions(); }
  clearSessionCookie(res);
  res.json({ success: true });
});

// Restaure la session au rechargement (remplace localStorage)
app.get('/api/me', async (req, res) => {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Non authentifié' });
  const account = await DB.getAccount();
  if (!account) return res.status(401).json({ error: 'Compte introuvable' });
  res.json({
    success: true,
    user: { username: account.username, email: account.email, handle: account.handle }
  });
});

app.get('/api/account-exists', async (req, res) => {
  const account = await DB.getAccount();
  res.json({ exists: !!account, ownerEmail: OWNER_EMAIL, ownerHandle: OWNER_HANDLE });
});

// ─────────────────────────────────────────────────────────────
// 1) UPLOAD de documents
// ─────────────────────────────────────────────────────────────
app.post('/api/upload-strategies', requireAuth, upload.array('documents'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Aucun fichier uploadé' });
    }
    const results = [];

    for (const file of req.files) {
      const filePath = file.path;
      const ext = path.extname(file.originalname).toLowerCase();
      const baseName = path.basename(file.originalname, ext);
      let text = '';

      try {
        if (ext === '.txt' || ext === '.md') {
          text = await fs.readFile(filePath, 'utf-8');
        } else if (ext === '.pdf') {
          text = await extractPDF(filePath);
        } else if (ext === '.docx') {
          text = await extractDocx(filePath);
        } else {
          text = `Document ${file.originalname} (extraction non supportée)`;
        }
      } catch (e) {
        text = `Erreur extraction ${file.originalname}: ${e.message}`;
      }

      const strategy = {
        id: newId('doc_'),
        title: baseName,
        content: text,
        type: `file${ext}`,
        originalFileName: file.originalname,
        fileSize: file.size,
        source: 'upload',
        tags: extractTags(text),
        createdAt: new Date().toISOString()
      };
      await saveStrategy(strategy);
      await fs.rename(filePath, path.join(DOCUMENTS_DIR, file.originalname)).catch(() => {});

      results.push({ success: true, strategy, message: `${file.originalname} traité` });
    }
    res.json({ success: true, results });
  } catch (error) {
    console.error('Erreur upload:', error);
    res.status(500).json({ error: error.message });
  }
});

async function extractPDF(filePath) {
  try {
    const pdfParse = require('pdf-parse');
    const buf = await fs.readFile(filePath);
    const data = await pdfParse(buf);
    return data.text;
  } catch (e) {
    throw new Error('PDF illisible: ' + e.message);
  }
}

async function extractDocx(filePath) {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec(`pandoc "${filePath}" -t plain -o -`, (error, stdout) => {
      if (error || !stdout) {
        resolve('Conversion DOCX impossible (pandoc absent). Contenu à saisir manuellement.');
      } else {
        resolve(stdout);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────
// 2) SAISIE MANUELLE
// ─────────────────────────────────────────────────────────────
app.post('/api/knowledge', requireAuth, async (req, res) => {
  try {
    const { title, content, type, source } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'Titre et contenu requis' });
    }
    const strategy = {
      id: newId('man_'),
      title,
      content,
      type: type || 'strategy',
      source: source || 'manual',
      tags: extractTags(content),
      createdAt: new Date().toISOString()
    };
    await saveStrategy(strategy);
    res.json({ success: true, strategy });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 3) SCRAPING d'URL + extraction IA
// ─────────────────────────────────────────────────────────────
async function fetchPageText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) 5trade/1.0',
      'Accept': 'text/html,application/xhtml+xml'
    },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  let cheerio;
  try { cheerio = require('cheerio'); } catch { cheerio = null; }

  if (cheerio) {
    const $ = cheerio.load(html);
    $('script, style, nav, header, footer, aside, noscript, iframe').remove();
    const title = ($('title').text() || '').trim();
    const body = $('article').length ? $('article').text() : $('body').text();
    const clean = body.replace(/\s+/g, ' ').trim();
    return { title, text: clean.slice(0, 40000) };
  }
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { title: '', text: text.slice(0, 40000) };
}

async function structureStrategyWithAI(rawText, sourceUrl, fallbackTitle) {
  const prompt = `Tu es un analyste qui extrait des stratégies de trading.
Voici le contenu brut d'une page web. Extrais la ou les stratégies/concepts de trading présents.

CONTENU:
"""
${rawText.slice(0, 24000)}
"""

Réponds en JSON strict:
{
  "title": "titre court de la stratégie",
  "summary": "résumé du concept en 2-3 phrases",
  "rules": {
    "entry": "règle d'entrée précise",
    "exit": "règle de sortie",
    "stopLoss": "placement du stop loss",
    "takeProfit": "objectif",
    "timeframes": ["H1","M15"],
    "pairs": ["XAUUSD"],
    "sessions": ["London","New York"]
  },
  "concepts": ["liste des concepts clés"],
  "tags": ["mots-clés"],
  "conditions": "quand ne PAS trader cette stratégie",
  "confidence": "high|medium|low"
}`;

  try {
    const out = await deepseek([{ role: 'user', content: prompt }], { maxTokens: 1600, json: true });
    const parsed = JSON.parse(out);
    parsed.sourceUrl = sourceUrl;
    return parsed;
  } catch (e) {
    return {
      title: fallbackTitle || 'Stratégie web',
      summary: rawText.slice(0, 300),
      rules: {},
      concepts: [],
      tags: extractTags(rawText),
      sourceUrl,
      confidence: 'low',
      error: e.message
    };
  }
}

app.post('/api/scrape-strategies', requireAuth, async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: 'urls requis (tableau)' });
    }
    const results = [];
    for (const url of urls) {
      try {
        const { title, text } = await fetchPageText(url);
        if (!text || text.length < 100) throw new Error('Contenu insuffisant');
        const parsed = await structureStrategyWithAI(text, url, title);
        const strategy = {
          id: newId('web_'),
          title: parsed.title || title || url,
          content: parsed.summary ? `${parsed.summary}\n\n${text.slice(0, 6000)}` : text.slice(0, 6000),
          type: 'web-strategy',
          source: 'scrape',
          sourceUrl: url,
          structured: parsed,
          tags: parsed.tags || extractTags(text),
          createdAt: new Date().toISOString()
        };
        await saveStrategy(strategy);
        results.push({ success: true, url, strategy });
      } catch (e) {
        results.push({ success: false, url, error: e.message });
      }
    }
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 4) RECHERCHE WEB AUTONOME
// ─────────────────────────────────────────────────────────────
async function webSearch(query, limit = 8) {
  const results = [];
  // DuckDuckGo HTML (sans clé API)
  try {
    const res = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `q=${encodeURIComponent(query)}`
    });
    const html = await res.text();
    let cheerio;
    try { cheerio = require('cheerio'); } catch { cheerio = null; }
    if (cheerio) {
      const $ = cheerio.load(html);
      $('.result').each((i, el) => {
        if (results.length >= limit) return;
        const a = $(el).find('.result__a').first();
        let href = a.attr('href') || '';
        const m = href.match(/uddg=([^&]+)/);
        if (m) href = decodeURIComponent(m[1]);
        const title = a.text().trim();
        const snippet = $(el).find('.result__snippet').text().trim();
        if (href.startsWith('http') && title) results.push({ title, url: href, snippet });
      });
    }
  } catch (e) {
    console.error('webSearch:', e.message);
  }
  return results;
}

app.post('/api/search-and-save', requireAuth, async (req, res) => {
  try {
    const { query, limit = 5, autoSave = true } = req.body;
    if (!query) return res.status(400).json({ error: 'query requis' });

    const found = await webSearch(query, Math.max(limit, 5));
    if (found.length === 0) {
      return res.json({ success: true, found: [], saved: [], message: 'Aucun résultat' });
    }

    const saved = [];
    const details = [];

    for (const item of found.slice(0, limit)) {
      try {
        const { text } = await fetchPageText(item.url);
        if (!text || text.length < 200) {
          details.push({ ...item, skipped: 'contenu insuffisant' });
          continue;
        }
        if (autoSave) {
          const parsed = await structureStrategyWithAI(text, item.url, item.title);
          const strategy = {
            id: newId('srch_'),
            title: parsed.title || item.title,
            content: `${parsed.summary || ''}\n\n${text.slice(0, 6000)}`,
            type: 'web-strategy',
            source: 'search',
            sourceUrl: item.url,
            structured: parsed,
            tags: parsed.tags || extractTags(text),
            createdAt: new Date().toISOString()
          };
          await saveStrategy(strategy);
          saved.push(strategy);
          details.push({ ...item, saved: true, strategyId: strategy.id });
        } else {
          details.push({ ...item, textPreview: text.slice(0, 400) });
        }
      } catch (e) {
        details.push({ ...item, error: e.message });
      }
    }

    res.json({ success: true, found, saved, details, query });
  } catch (error) {
    console.error('search-and-save:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 5) FORUMS / SOURCES CONNUES
// ─────────────────────────────────────────────────────────────
const FORUM_SOURCES = {
  forexfactory: 'site:forexfactory.com trading strategy system',
  tradingview: 'site:tradingview.com strategy idea',
  reddit: 'site:reddit.com r/Forex trading strategy',
  babypips: 'site:babypips.com trading strategy',
  investopedia: 'site:investopedia.com trading strategy technical analysis'
};

app.post('/api/scrape-forums', requireAuth, async (req, res) => {
  try {
    const { forum, keywords = '', limit = 5 } = req.body;
    const base = FORUM_SOURCES[forum];
    if (!base) {
      return res.status(400).json({
        error: 'Forum non supporté',
        supported: Object.keys(FORUM_SOURCES)
      });
    }
    const query = keywords ? `${base} ${keywords}` : base;
    const found = await webSearch(query, limit);

    const saved = [];
    for (const item of found.slice(0, limit)) {
      try {
        const { text } = await fetchPageText(item.url);
        if (!text || text.length < 200) continue;
        const parsed = await structureStrategyWithAI(text, item.url, item.title);
        const strategy = {
          id: newId('forum_'),
          title: parsed.title || item.title,
          content: `${parsed.summary || ''}\n\n${text.slice(0, 6000)}`,
          type: 'forum-strategy',
          source: forum,
          sourceUrl: item.url,
          structured: parsed,
          tags: parsed.tags || extractTags(text),
          createdAt: new Date().toISOString()
        };
        await saveStrategy(strategy);
        saved.push(strategy);
      } catch (e) {
        // continue
      }
    }
    res.json({ success: true, forum, found, saved });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/forums', (req, res) => {
  res.json({ success: true, forums: Object.keys(FORUM_SOURCES) });
});

// ─────────────────────────────────────────────────────────────
// LISTING / SUPPRESSION
// ─────────────────────────────────────────────────────────────
app.get('/api/knowledge', requireAuth, async (req, res) => {
  try {
    const strategies = await loadAllStrategies();
    res.json({ success: true, strategies, count: strategies.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/knowledge/:id', requireAuth, async (req, res) => {
  try {
    await DB.removeStrategyRecord(req.params.id);
    await fs.unlink(path.join(KNOWLEDGE_BASE_DIR, `${req.params.id}.json`)).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/documents', requireAuth, async (req, res) => {
  try {
    const files = await fs.readdir(DOCUMENTS_DIR).catch(() => []);
    const documents = [];
    for (const f of files) {
      const st = await fs.stat(path.join(DOCUMENTS_DIR, f));
      documents.push({
        name: f,
        size: st.size,
        uploadDate: st.birthtime,
        type: path.extname(f).toLowerCase()
      });
    }
    res.json({ success: true, documents });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/documents/:filename', requireAuth, async (req, res) => {
  try {
    await fs.unlink(path.join(DOCUMENTS_DIR, req.params.filename));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────
// ANALYSE MULTI-TIMEFRAME + COMBINAISON DE STRATÉGIES
// ─────────────────────────────────────────────────────────────
const chartUpload = upload.fields([
  { name: 'charts', maxCount: 4 },
  { name: 'chart', maxCount: 1 }
]);

app.post('/api/analyze', requireAuth, chartUpload, async (req, res) => {
  try {
    const files = [
      ...(req.files?.charts || []),
      ...(req.files?.chart || [])
    ];
    if (files.length === 0) {
      return res.status(400).json({ error: 'Aucune image uploadée' });
    }

    const pair = req.body.pair || 'XAUUSD';
    let timeframes = req.body.timeframes || req.body.timeframe || 'H1';
    if (typeof timeframes === 'string') {
      timeframes = timeframes.split(',').map(t => t.trim()).filter(Boolean);
    }
    const notes = req.body.notes || '';
    const maxStrategies = parseInt(req.body.maxStrategies || '3', 10);

    // 1. Analyse visuelle par DeepSeek (multimodal)
    const visionPrompt = `Tu es un trader professionnel en analyse price action (aucun indicateur, uniquement structure, prix brut, liquidité).
Analyse les ${files.length} capture(s) de graphique(s) TradingView fournie(s).

Paire: ${pair}
Timeframes (dans l'ordre des images): ${timeframes.join(', ')}
${notes ? 'Contexte du trader: ' + notes : ''}

Pour CHAQUE timeframe, décris précisément :
- tendance et structure (HH/HL, LH/LL, range)
- niveaux clés (support/résistance, zones de liquidité)
- order blocks / FVG / imbalances visibles
- dernier CHoCH / BOS
- signaux de réaction (rejet, engulfing, pin bar)
- biais (bullish / bearish / neutre) et pourquoi

Puis donne une lecture multi-timeframe : alignement ou conflit entre les timeframes.
Sois factuel : ne décris que ce qui est réellement visible. Si une image est illisible, dis-le.

Réponds en texte structuré, dense et exploitable.`;

    // 1. Analyse visuelle — Gemini (deepseek-chat ne voit pas les images)
    const images = [];
    for (const f of files) {
      images.push({
        mimeType: f.mimetype || 'image/png',
        base64: (await fs.readFile(f.path)).toString('base64')
      });
    }
    const visionAnalysis = await vision.analyzeImages(images, visionPrompt);

    // 2. Recherche dans la base de connaissance
    const all = await loadAllStrategies();
    const matched = searchKnowledgeBase(all, { pair, timeframes, visionAnalysis });
    const top = matched.slice(0, maxStrategies);

    // 3. Combinaison des stratégies + plan d'action via DeepSeek
    let plan;
    try {
      plan = await buildPlan({ pair, timeframes, visionAnalysis, strategies: top });
    } catch (e) {
      plan = {
        action: 'HOLD',
        reason: 'Combinaison indisponible: ' + e.message,
        confidence: 'low',
        entry: {}, nextSteps: [], risk: 'medium'
      };
    }

    // Upload des captures vers Cloudinary (si configuré), puis nettoyage
    const chartUrls = [];
    for (const f of files) {
      if (cloudReady()) {
        try {
          const up = await uploadToCloudinary(f.path);
          chartUrls.push({
            url: up.secure_url,
            publicId: up.public_id,
            width: up.width,
            height: up.height
          });
        } catch (e) {
          console.error('Cloudinary upload:', e.message);
        }
      }
      await fs.unlink(f.path).catch(() => {});
    }

    const analysis = {
      pair,
      timeframes,
      visionAnalysis,
      imagesAnalyzed: files.length,
      charts: chartUrls,
      storage: storageStatus(),
      analysisDate: new Date().toISOString()
    };

    const recommendations = {
      ...plan,
      strategiesUsed: top.map(s => ({
        id: s.id,
        title: s.title,
        type: s.type,
        source: s.source,
        relevanceScore: s.relevanceScore
      })),
      candidatesFound: matched.length
    };

    await appendHistory({
      id: newId('hist_'),
      pair,
      timeframes,
      action: plan.action,
      confidence: plan.confidence,
      reason: plan.reason,
      strategiesUsed: recommendations.strategiesUsed,
      timestamp: analysis.analysisDate
    });

    res.json({ success: true, analysis, recommendations });
  } catch (error) {
    console.error('Erreur analyse:', error);
    res.status(500).json({ error: error.message });
  }
});

function searchKnowledgeBase(all, { pair, timeframes, visionAnalysis }) {
  const tfList = Array.isArray(timeframes) ? timeframes : [timeframes];
  const haystackContext = (visionAnalysis || '').toLowerCase();
  const ctxWords = new Set(
    haystackContext.split(/[^a-z0-9]+/).filter(w => w.length > 4).slice(0, 300)
  );

  const scored = all.map(s => {
    const text = `${s.title} ${s.content || ''} ${(s.tags || []).join(' ')} ${JSON.stringify(s.structured || {})}`.toLowerCase();
    let score = 0;

    if (text.includes(String(pair).toLowerCase())) score += 4;
    tfList.forEach(tf => { if (text.includes(tf.toLowerCase())) score += 2; });

    // recouvrement sémantique simple avec l'analyse visuelle
    let overlap = 0;
    ctxWords.forEach(w => { if (text.includes(w)) overlap++; });
    score += Math.min(overlap, 15) * 0.6;

    (s.tags || []).forEach(t => { if (haystackContext.includes(t.toLowerCase())) score += 1.5; });

    if (s.structured && s.structured.rules && Object.keys(s.structured.rules).length) score += 2;

    return { ...s, relevanceScore: Math.round(score * 10) / 10 };
  });

  return scored
    .filter(s => s.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

async function buildPlan({ pair, timeframes, visionAnalysis, strategies }) {
  const strategiesBlock = strategies.length
    ? strategies.map((s, i) => {
        const rules = s.structured?.rules || {};
        return `--- STRATÉGIE ${i + 1}: ${s.title} (source: ${s.source || s.type}, pertinence: ${s.relevanceScore}) ---
Résumé: ${s.structured?.summary || (s.content || '').slice(0, 700)}
Règles: ${JSON.stringify(rules)}
Concepts: ${(s.structured?.concepts || s.tags || []).join(', ')}
Conditions défavorables: ${s.structured?.conditions || 'non précisé'}`;
      }).join('\n\n')
    : 'AUCUNE stratégie correspondante dans la base de connaissance.';

  const prompt = `Tu es un analyste trading senior. Tu dois combiner les stratégies de la base avec l'analyse visuelle actuelle et produire un PLAN D'ACTION concret.

PAIRE: ${pair}
TIMEFRAMES: ${timeframes.join(', ')}

=== ANALYSE VISUELLE DES GRAPHIQUES ===
${visionAnalysis}

=== STRATÉGIES DISPONIBLES DANS LA BASE ===
${strategiesBlock}

=== CONSIGNES ===
- Combine 2 à 3 stratégies maximum (intersection des conditions favorables, pas addition naïve).
- Donne un plan étape par étape : QUOI faire, QUAND, AVANT QUOI, et QUOI faire ensuite.
- Sois précis sur les prix/niveaux quand l'analyse visuelle les fournit.
- Si les signaux sont contradictoires, action = HOLD et explique pourquoi.
- Si aucune stratégie ne correspond, dis-le clairement et propose une lecture price action pure.

Réponds en JSON strict:
{
  "action": "BUY|SELL|HOLD|WAIT",
  "confidence": "high|medium|low",
  "reason": "justification combinée en 2-3 phrases",
  "strategiesCombined": ["noms des stratégies retenues"],
  "entry": { "zone": "prix/zone d'entrée", "trigger": "déclencheur exact", "timeframe": "TF d'exécution" },
  "stopLoss": { "level": "niveau", "reason": "logique" },
  "takeProfit": [{ "level": "niveau", "reason": "logique" }],
  "riskManagement": { "riskPerTrade": "%", "positionSize": "logique", "rr": "ratio risque/rendement" },
  "executionPlan": [
    { "step": 1, "when": "à quel moment", "do": "quoi faire", "before": "prérequis" }
  ],
  "nextSteps": ["ce qui doit être surveillé ensuite"],
  "invalidation": "ce qui annule le scénario",
  "risk": "low|medium|high"
}`;

  const out = await deepseek([{ role: 'user', content: prompt }], { maxTokens: 2200, json: true });
  return JSON.parse(out);
}

// ─────────────────────────────────────────────────────────────
// HISTORIQUE
// ─────────────────────────────────────────────────────────────
app.get('/api/history', requireAuth, async (req, res) => {
  const history = await DB.loadHistory();
  res.json({ success: true, history });
});

// ─────────────────────────────────────────────────────────────
// JOURNAL DE TRADES
// ─────────────────────────────────────────────────────────────
async function tradesWithStats() {
  const list = await DB.listTrades();
  const all = await loadAllStrategies();
  const titles = Object.fromEntries(all.map(s => [s.id, s.title]));
  return { trades: list, stats: Trades.computeStats(list, titles) };
}

app.get('/api/trades', requireAuth, async (req, res) => {
  try { res.json({ success: true, ...(await tradesWithStats()) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/trades/stats', requireAuth, async (req, res) => {
  try { res.json({ success: true, stats: (await tradesWithStats()).stats }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/trades', requireAuth, async (req, res) => {
  try {
    const trade = { id: newId('trd_'), ...Trades.normalize(req.body) };
    await DB.saveTradeRecord(trade);
    res.json({ success: true, trade });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.patch('/api/trades/:id', requireAuth, async (req, res) => {
  try {
    const list = await DB.listTrades();
    const current = list.find(t => t.id === req.params.id);
    if (!current) return res.status(404).json({ error: 'Trade introuvable' });

    const action = String(req.body.action || 'close').toLowerCase();
    let updated;

    if (action === 'close') {
      updated = Trades.close(current, req.body);
    } else {
      // mise à jour de champs sûrs uniquement (statut/identité intouchables)
      updated = { ...current };
      for (const k of ['notes', 'size', 'strategyIds']) {
        if (k in req.body) updated[k] = req.body[k];
      }
      if ('sl' in req.body || 'tp' in req.body) {
        const sl = Trades.num(req.body.sl !== undefined ? req.body.sl : current.sl);
        const tp = Trades.num(req.body.tp !== undefined ? req.body.tp : current.tp);
        updated.sl = sl; updated.tp = tp;
        updated.risk = sl !== null ? Math.abs(current.entry - sl) : null;
        updated.reward = tp !== null ? Math.abs(tp - current.entry) : null;
        updated.plannedRR = updated.risk && updated.reward
          ? +(updated.reward / updated.risk).toFixed(2) : null;
      }
    }

    await DB.saveTradeRecord(updated);
    res.json({ success: true, trade: updated });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/trades/:id', requireAuth, async (req, res) => {
  try {
    await DB.removeTradeRecord(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
// STATISTIQUES BASE
// ─────────────────────────────────────────────────────────────
app.get('/api/stats', requireAuth, async (req, res) => {
  const all = await loadAllStrategies();
  const bySource = {};
  all.forEach(s => { bySource[s.source || 'autre'] = (bySource[s.source || 'autre'] || 0) + 1; });
  res.json({
    success: true,
    total: all.length,
    bySource,
    byType: all.reduce((a, s) => { a[s.type || 'autre'] = (a[s.type || 'autre'] || 0) + 1; return a; }, {})
  });
});

app.get('/api/storage-status', requireAuth, (req, res) => {
  res.json({ success: true, storage: storageStatus() });
});

// Configuration active (provider vision, stockage) — visible par le client
app.get('/api/config', requireAuth, (req, res) => {
  res.json({ success: true, vision: vision.visionInfo(), storage: storageStatus() });
});

// ─────────────────────────────────────────────────────────────
// Démarrage
// ─────────────────────────────────────────────────────────────
async function start() {
  await ensureDirs();
  await DB.init();
  await loadSessions();
  app.listen(PORT, () => {
    console.log('═══════════════════════════════════════');
    console.log('  5trade — plateforme de trading IA');
    console.log('═══════════════════════════════════════');
    console.log(`  API        : http://localhost:${PORT}/api`);
    console.log(`  Base       : ${KNOWLEDGE_BASE_DIR}`);
    console.log(`  Modèle IA  : ${DEEPSEEK_MODEL}`);
    const v = vision.visionInfo();
    console.log(`  Vision     : ${v.provider} / ${v.model}${vision.visionReady() ? '' : '  (clé manquante)'}`);
    console.log(`  Clé DeepSeek: ${process.env.DEEPSEEK_API_KEY && !process.env.DEEPSEEK_API_KEY.includes('your_deepseek') ? '✅ configurée' : '❌ manquante (.env)'}`);
    console.log('═══════════════════════════════════════');
  });
}

start();
