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
const compression = require('compression');
const DB = require('./db');
// UN SEUL chargement. Le second appel (fallback « .env dans api/ ») etait inutile
// et risque : dotenv cherche alors dans le dossier courant et peut ecraser des
// valeurs deja chargees par un fichier non prevu.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
// URL surchargeable : pointe-la vers un relai local OpenAI-compatible
// (ex. Ollama : http://localhost:11434/v1/chat/completions) pour du 0 $.
const DEEPSEEK_URL = process.env.DEEPSEEK_URL || 'https://api.deepseek.com/v1/chat/completions';

// ─── Budget IA : moins de tokens, et pas deux fois le même appel ───
// Le plan d'analyse était demandé à 2200 tokens alors que la réponse JSON
// tient largement en dessous : chaque appel payait de la marge inutilisée.
const PLAN_MAX_TOKENS = Number(process.env.PLAN_MAX_TOKENS || 1500);
// Cache de plans : une même analyse relancée ne doit pas être repayée.
const CACHE_PLAN_MAX = Number(process.env.CACHE_PLAN_MAX || 40);
const CACHE_PLAN_TTL_MS = Number(process.env.CACHE_PLAN_TTL_MIN || 30) * 60 * 1000;
const cachePlan = new Map(); // empreinte du prompt -> { at, plan }

// ─────────────────────────────────────────────────────────────
// Chemins
// ─────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const KNOWLEDGE_BASE_DIR = path.join(ROOT, 'knowledge-base');
const DOCUMENTS_DIR = path.join(KNOWLEDGE_BASE_DIR, 'documents');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
// Le compte et l'historique vivent désormais en base (api/db.js) :
// plus de lecture/écriture directe de fichiers ici.

// ─────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────
// CORS : `cors()` sans argument accepte TOUTES les origines — n'importe quel site
// pouvait donc appeler cette API, cookies de session compris.
//
// On RESTREINT PAR DÉFAUT. Un premier correctif autorisait tout hors production :
// c'était un faux filet — un serveur lancé sans NODE_ENV=production (le cas
// courant) redevenait ouvert à tout le web. C'est l'inverse qu'il faut : seules
// les origines connues passent, et l'ouverture totale se DEMANDE explicitement
// (CORS_LIBRE=1), pour une session de travail assumée.
const ORIGINES_LOCALES = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
app.use(cors({
  credentials: true,
  origin(origine, cb) {
    if (!origine) return cb(null, true);                                  // même origine, curl
    if (ORIGINES_LOCALES.test(origine)) return cb(null, true);            // l'appli elle-même
    if (process.env.APP_ORIGIN && origine === process.env.APP_ORIGIN) return cb(null, true);
    if (process.env.CORS_LIBRE === '1') return cb(null, true);            // demande explicite
    cb(null, false);                                                      // tout le reste : non
  }
}));
// Compression : les reponses de bougies depassent souvent 100 Ko de JSON, qui se
// compriment a ~10 %. Sans elle, chaque rafraichissement de graphique transporte
// l'integralite du texte.
app.use(compression());

// En-tetes de securite, poses a la main plutot que via helmet : cinq lignes
// suffisent ici, et ca evite une dependance de plus.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');      // pas d'interpretation abusive du type
  res.setHeader('X-Frame-Options', 'DENY');                 // l'appli ne s'affiche pas dans une iframe
  res.setHeader('Referrer-Policy', 'same-origin');          // pas de fuite d'URL vers l'exterieur
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
});

// Limite du corps de requete : 60 Mo permettait de saturer la memoire du serveur
// avec quelques requetes. 12 Mo couvrent les captures d'ecran et les PDF joints ;
// surchargeable pour un besoin ponctuel.
const LIMITE_CORPS = process.env.BODY_LIMIT || '12mb';
app.use(express.json({ limit: LIMITE_CORPS }));
app.use(express.urlencoded({ extended: true, limit: LIMITE_CORPS }));
// Sonde de sante : permet de savoir si le serveur repond SANS traverser l'auth.
// Sans elle, un simple controle de disponibilite devait deviner une route.
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
    memoireMo: Math.round(process.memoryUsage().rss / 1048576),
    at: new Date().toISOString()
  });
});

app.use('/uploads', express.static(UPLOADS_DIR));
// Frontend servi sur la même origine (évite les soucis de CORS)
// Les fichiers statiques. La page HTML ne doit JAMAIS être mise en cache : le
// navigateur gardait l'ancienne version et l'utilisateur ne voyait pas les
// nouveautés (zones du graphique comprises) malgré un serveur à jour.
app.use(express.static(path.join(ROOT, 'frontend'), {
  setHeaders: (res, chemin) => {
    if (/\.html?$/i.test(chemin)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

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

/**
 * Nom de fichier sûr, à partir d'un nom fourni par le client.
 *
 * `path.join(dossier, nom)` avec un nom non filtré laisse SORTIR du dossier :
 * « ../../config.js » remonte l'arborescence. On ne garde donc que le dernier
 * segment du chemin, nettoyé des caractères qui posent problème sur disque, avec
 * une longueur bornée et un repli si plus rien ne reste.
 */
function nomSur(brut) {
  const base = path.basename(String(brut || 'fichier'));
  const propre = base.replace(/[^\w.\-() ]+/g, '_').replace(/^\.+/, '').slice(0, 120).trim();
  return propre || `fichier-${Date.now()}`;
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
    body: fd,
    signal: AbortSignal.timeout(30000) // 30s max
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d.message || `ImageKit HTTP ${res.status}`);
  return d;
}

// ─── S3 (Cloudflare R2) — implémentation dans s3.js ───
const S3 = require('./s3');

// ─── Vision (Gemini) — implémentation dans vision.js ───
const vision = require('./vision');
const Couts = require('./couts');

// ─── Calendrier économique — implémentation dans fundamentals.js ───
const { filtreCalendrier } = require('./fundamentals');

// ─── Risque de portefeuille — implémentation dans portfolioRisk.js ───
const { risqueTotal, peutOuvrirPosition } = require('./portfolioRisk');

// ─── Protection drawdown — implémentation dans drawdownProtection.js ───
const { calculerDrawdown, ajusterRisque, courbeEquity } = require('./drawdownProtection');

// ─── Dashboard — implémentation dans dashboard.js ───
const { buildDashboard } = require('./dashboard');

// ─── Volume Profile — implémentation dans volumeProfile.js ───
const { volumeProfile, niveauxVolume, gapsVolume } = require('./volumeProfile');

// ─── Force des devises — implémentation dans currencyStrength.js ───
const { forceDevises, classeDevises, paireLaPlusForte, matriceCorrelation } = require('./currencyStrength');

// ─── Corrélation dynamique — implémentation dans correlation.js ───
const { correlationGlissante, ajusterTailleParCorrelation, ruptureCorrelation } = require('./correlation');

// ─── Backtesting visuel — implémentation dans backtestUI.js ───
const { backtestVisuel } = require('./backtestUI');

// ─── London Breakout — implémentation dans londonBreakout.js ───
const { rangeAsiatique, londonBreakout, evaluerQualite } = require('./londonBreakout');

// ─── Divergences — implémentation dans divergences.js ───
const { detecterDivergences, detecterDivergencesMACD } = require('./divergences');

// ─── Ajustement dynamique du risque — implémentation dans dynamicRisk.js ───
const { ajusterRisqueATR, risqueAjuste, conditionsFavorables } = require('./dynamicRisk');

// ─── COT Report — implémentation dans cotReport.js ───
const { getCOT, analyserCOT, tendanceCOT } = require('./cotReport');

// ─── Taux d'intérêt — implémentation dans interestRates.js ───
const { getTauxInteret, ecartTaux, analyseTaux, classeTaux } = require('./interestRates');

// ─── Pattern Recognition — implémentation dans patternRecognition.js ───
const { detecterPatterns } = require('./patternRecognition');

// ─── Signal Scoring ML — implémentation dans signalScoring.js ───
const { entrainerModele, predireSucces, ajusterSeuil, evaluerModele } = require('./signalScoring');

// ─── Order Flow — implémentation dans orderFlow.js ───
const { analyserOrderFlow } = require('./orderFlow');

// ─── Anomaly Detection — implémentation dans anomalyDetection.js ───
const { analyserAnomalies } = require('./anomalyDetection');

// ─── Alertes push — implémentation dans pushAlerts.js ───
const { configurerVAPID, vapidPret, envoyerNotification } = require('./pushAlerts');

// Envoi push : diffuse aux abonnements du navigateur, purge les expirés.
// Injecté à la surveillance comme sendMail (alerts.js ne connaît que deps).
async function sendPush(payload) {
  let ok = 0;
  for (const sub of Alerts.listerAbonnements()) {
    try {
      const r = await envoyerNotification(sub, payload);
      if (r.success) ok++;
      else if (r.expired) Alerts.retirerAbonnement(sub.endpoint);
    } catch { /* un abonné mort ne bloque pas les autres */ }
  }
  return ok;
}

// ─── Multi-comptes — implémentation dans multiAccount.js ───
const { creerCompte, listerComptes, getCompte, mettreAJourCapital, supprimerCompte, pnlCompte } = require('./multiAccount');

// ─── Export PDF — implémentation dans exportPDF.js ───
const { genererRapportPDF, genererCSVEnrichi } = require('./exportPDF');

// ─── Journal de trades — logique dans trades.js ───
const Trades = require('./trades');

// ─── Recherche plein-texte dans la base de connaissance ───
const Search = require('./search');

// ─── Export du journal (CSV / JSON) ───
const Export = require('./export');

// ─── Marché temps réel (bourses / proxys) ───
const Market = require('./market');

// ─── Analyse de structure sur données exactes ───
const Structure = require('./structure');

// ─── Signaux (stratégie appliquée + confirmation achat/vente) ───
const Signals = require('./signals');
// Moteur multi-signaux : une liste de signaux (un par stratégie, un par motif)
// au lieu d'un verdict unique. Voir signaux.js et patterns.js.
const Multi = require('./signaux');
const Patterns = require('./patterns');
// Journal des signaux : persiste chaque signal émis puis enregistre son ISSUE
// réelle (objectif 1/2, stop, retour à l'entrée). Sans ça, aucune stratégie ne
// peut être jugée — on ne garde que des opinions.
const JournalSignaux = require('./journal-signaux');
// Backtest : rejoue le moteur sur l'historique avec le MÊME code que le direct,
// pour répondre à la seule question qui compte — est-ce que ça gagne ?
const Backtest = require('./backtest');
// Actualités et calendrier économique : flux publics, sans clé ni compte.
const News = require('./news');
const Alerts = require('./alerts');
const Lexique = require('./lexique');
// Base de concepts : les définitions des termes, injectées dans l'analyse IA.
const Concepts = require('./concepts');
// Playbooks : les types de trade (scalping, chasse à la liquidité, intraday,
// swing), chacun avec ses prérequis et ses étapes évalués sur le graphique.
const Playbooks = require('./playbooks');

// Données de marché mises en cache sur disque : l'analyse doit rester
// possible même sans réseau (et après un redémarrage).
try {
  const cached = Market.loadCache();
  if (cached) console.log(`   Marché     : ${cached} série(s) rechargée(s) du cache hors ligne`);
} catch { /* pas de cache : on partira du réseau */ }

// ─── Robustesse : un incident réseau ne doit pas tuer le serveur ───
// Un flux de marché qui se coupe (ou un client SSE qui part trop tôt) ne doit
// jamais faire tomber l'API. Comme le serveur tourne sans superviseur, on
// absorbe UNIQUEMENT les erreurs d'origine réseau ; tout le reste est fatal,
// pour ne surtout pas masquer un vrai bug.
process.on('uncaughtException', (err) => {
  const msg = (err && err.message) || String(err);
  if (/websocket|socket|ECONNRESET|EPIPE|aborted/i.test(msg)) {
    console.error('   Marché     : incident réseau absorbé —', msg);
    return;
  }
  console.error('[ERREUR FATALE]', msg);
  console.error(err && err.stack ? err.stack : '');
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  const msg = (err && err.message) || String(err);
  if (/websocket|socket|ECONNRESET|EPIPE|aborted/i.test(msg)) {
    console.error('   Marché     : incident réseau absorbé —', msg);
    return;
  }
  console.error('[PROMESSE REJETÉE]', msg);
});

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

// Même schéma lecture-modification-écriture que les OTP : `await loadHistory()`
// puis `await saveHistory()`. Deux analyses lancées en même temps lisaient le
// même historique et la seconde écrasait la première — une entrée disparaissait
// sans trace. On enchaîne les ajouts.
let fileHistoire = Promise.resolve();
function appendHistory(entry) {
  const suite = fileHistoire.then(async () => {
    const history = await DB.loadHistory();
    history.unshift(entry);
    await DB.saveHistory(history.slice(0, 200));
  });
  fileHistoire = suite.then(() => {}, () => {});
  return suite;
}

// ─────────────────────────────────────────────────────────────
// DeepSeek
// ─────────────────────────────────────────────────────────────
async function deepseek(messages, { maxTokens = 2000, json = false, route = 'ia' } = {}) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || key.includes('your_deepseek')) {
    throw new Error('DEEPSEEK_API_KEY non configurée dans .env');
  }
  // Garde-fou : on refuse AVANT de dépenser si le plafond mensuel est atteint.
  Couts.verifierBudget();
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
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000) // 30s max — un API qui ne répond pas ne doit pas bloquer le serveur
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || `DeepSeek HTTP ${res.status}`;
    // Solde épuisé : message actionnable au lieu d'un code obscur.
    if (res.status === 402 || /insufficient|balance|quota|exceeded|billing/i.test(msg)) {
      const e = new Error(
        `Solde IA épuisé (${msg}). L'onglet Direct (moteur local, gratuit) reste ` +
        `disponible ; recharge ton solde ou pointe DEEPSEEK_URL vers un relai local (Ollama).`
      );
      e.status = 503;
      throw e;
    }
    throw new Error(msg);
  }
  const contenu = data.choices[0].message.content;
  // Journalisation du coût réel (jamais bloquante).
  try {
    const usage = data.usage || {};
    Couts.enregistrer({
      route,
      modele: body.model,
      entree: Number(usage.prompt_tokens) || Couts.estimerEntree(messages),
      sortie: Number(usage.completion_tokens) || Couts.estimerTokens(contenu)
    });
  } catch { /* le comptage ne doit jamais casser une analyse */ }
  return contenu;
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

// Anti-emballement sur les routes qui COÛTENT : /api/analyze appelle une IA
// facturée à la requête. Un onglet laissé ouvert ou une boucle côté client peut
// vider le crédit en quelques minutes. Par COMPTE et non par IP : c'est
// l'utilisateur authentifié qui consomme, et plusieurs navigateurs peuvent
// partager une IP. Généreux — 15 analyses / 5 min suffisent à l'usage normal.
const analysesParCompte = {};
function rateLimitAnalyse(req, res, next) {
  const compte = (req.session && req.session.username) || req.ip || 'x';
  const now = Date.now();
  const FENETRE = 5 * 60 * 1000;
  const LIMIT = process.env.NODE_ENV === 'production' ? 15 : 60;
  const a = analysesParCompte[compte] || { count: 0, until: 0 };
  if (a.until > now && a.count >= LIMIT) {
    const s = Math.ceil((a.until - now) / 1000);
    return res.status(429).json({
      error: `Trop d'analyses coup sur coup. Réessayez dans ${s} s — chaque analyse appelle une IA facturée.`
    });
  }
  if (a.until < now) { a.count = 0; a.until = now + FENETRE; }
  a.count++;
  analysesParCompte[compte] = a;
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

/**
 * SÉRIALISATION DES OPÉRATIONS OTP.
 *
 * `issueOtp` et `verifyOtp` suivent tous deux le schéma : lire le store
 * (`await DB.loadOtp()`) → le modifier → l'écrire (`await DB.saveOtp()`).
 * Node est mono-thread, mais l'`await` de la lecture ouvre une vraie fenêtre :
 * deux appels simultanés lisent le MÊME store, et le second écrase le premier.
 *
 * Conséquence concrète sur `verifyOtp` : `rec.attempts++` peut être perdu, donc
 * `OTP_MAX_ATTEMPTS` — la protection contre le bruteforce du code à 6 chiffres —
 * se contourne en envoyant les tentatives EN PARALLÈLE. Un compteur de sécurité
 * qui peut être perdu n'est pas un compteur.
 *
 * On enchaîne donc ces opérations au lieu de les entrelacer. Le coût est nul
 * (l'utilisateur est unique, ces appels ne durent pas) et l'invariant redevient
 * vrai : la dernière écriture part TOUJOURS d'un store à jour.
 */
let fileOtp = Promise.resolve();
function avecOtp(fn) {
  const suite = fileOtp.then(fn, fn);
  fileOtp = suite.then(() => {}, () => {});   // la file ne casse jamais
  return suite;
}
function issueOtp(username, purpose, opts) {
  return avecOtp(() => issueOtpBrut(username, purpose, opts));
}
function verifyOtp(username, code, purpose) {
  return avecOtp(() => verifyOtpBrut(username, code, purpose));
}

async function issueOtpBrut(username, purpose, { enforceCooldown = true } = {}) {
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

async function verifyOtpBrut(username, code, purpose) {
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
      let raisonEchec = null;

      try {
        if (ext === '.txt' || ext === '.md') {
          text = await fs.readFile(filePath, 'utf-8');
        } else if (ext === '.pdf') {
          text = await extractPDF(filePath);
        } else if (ext === '.docx') {
          text = await extractDocx(filePath);
        } else {
          text = null;
        }
      } catch (e) {
        text = null;
        raisonEchec = e.message;
      }

      // Sans texte exploitable, on n'enregistre RIEN. Une fiche vide — ou dont le
      // contenu est un message d'erreur — pollue la base et se fait passer pour
      // une stratégie. On dit simplement pourquoi le fichier a été écarté.
      if (!text || !String(text).trim()) {
        results.push({
          success: false, file: file.originalname,
          message: raisonEchec || 'Texte illisible'
            + (path.extname(file.originalname).toLowerCase() === '.docx'
              ? ' (pandoc est-il installé ?)' : '')
        });
        continue;
      }

      const strategy = {
        id: newId('doc_'),
        title: baseName,
        content: text,
        type: `file${ext}`,
        originalFileName: nomSur(file.originalname),
        fileSize: file.size,
        source: 'upload',
        tags: extractTags(text),
        createdAt: new Date().toISOString()
      };
      await saveStrategy(strategy);
      // Le nom vient du client : sans filtrage, « ../../x.js » fait SORTIR du
      // dossier (path traversal). On ne garde que le dernier segment du chemin,
      // debarrasse des caracteres genants.
      await fs.rename(filePath, path.join(DOCUMENTS_DIR, nomSur(file.originalname))).catch(() => {});

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
      // null, et non un message : l'appelant doit pouvoir distinguer « voici le
      // texte » de « je n'ai pas pu lire ce fichier ». Rendre une phrase d'excuse
      // faisait d'elle le CONTENU de la fiche — une stratégie enregistrée dont le
      // texte disait « conversion impossible ».
      resolve(error || !stdout ? null : stdout);
    });
  });
}

// ─────────────────────────────────────────────────────────────
// 2) SAISIE MANUELLE
// ─────────────────────────────────────────────────────────────
/**
 * Modification d'une stratégie existante.
 * Modifier le texte change AUSSI le profil d'analyse (les règles déduites) :
 * on renvoie donc le profil recalculé, pour que le mode manuel en tienne compte
 * immédiatement.
 */
app.put('/api/knowledge/:id', requireAuth, async (req, res) => {
  try {
    const { title, content, type, tags } = req.body || {};
    const strategies = await loadAllStrategies().catch(() => []);
    const existante = (strategies || []).find(x => x.id === req.params.id);
    if (!existante) return res.status(404).json({ error: 'Stratégie introuvable' });

    const contenuFinal = content !== undefined ? String(content).slice(0, 20000) : existante.content;
    const titreFinal = title !== undefined ? String(title).trim().slice(0, 200) : existante.title;
    if (!titreFinal || !contenuFinal) {
      return res.status(400).json({ error: 'Le titre et le contenu ne peuvent pas être vides' });
    }

    const maj = {
      ...existante,
      title: titreFinal,
      content: contenuFinal,
      type: type || existante.type || 'strategy',
      // Les étiquettes suivent le contenu si celui-ci change : une stratégie
      // dont on réécrit le texte ne doit pas garder les anciennes.
      tags: Array.isArray(tags) ? tags.map(String).slice(0, 20)
        : (content !== undefined ? extractTags(contenuFinal) : (existante.tags || [])),
      // Fonctionnement : normalisé avant enregistrement, aucune valeur hors
      // bornes n'entre en base. Un moteur vide (null) garde la déduction
      // automatique depuis le texte.
      moteur: 'moteur' in (req.body || {})
        ? (req.body.moteur ? Signals.normaliserMoteur(req.body.moteur) : null)
        : (existante.moteur || null),
      updatedAt: new Date().toISOString()
    };

    await saveStrategy(maj);
    const profil = Signals.profilDepuisStrategie(maj);
    res.json({ success: true, strategy: maj, profil });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
      // Fonctionnement défini à la création (facultatif) : la stratégie sait
      // alors exactement comment analyser, sans dépendre du texte.
      moteur: (req.body && req.body.moteur) ? Signals.normaliserMoteur(req.body.moteur) : null,
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
    redirect: 'follow',
    signal: AbortSignal.timeout(20000) // 20s max
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
    const out = await deepseek([{ role: 'user', content: prompt }], { maxTokens: 1600, json: true, route: 'structuration-web' });
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
      body: `q=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(15000) // 15s max
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

app.post('/api/analyze', requireAuth, rateLimitAnalyse, chartUpload, async (req, res) => {
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
    // IA visuelle coupée (clé absente, quota épuisé) : on continue en mode
    // dégradé — recherche locale + plan local — au lieu d'échouer.
    let visionAnalysis = '';
    try {
      visionAnalysis = await vision.analyzeImages(images, visionPrompt);
    } catch (e) {
      visionAnalysis = `Analyse visuelle indisponible (${e.message}).`;
    }

    // 1b. Vérification du calendrier économique — bloquer si news à fort impact
    const cal = await filtreCalendrier(pair);
    if (!cal.ok) {
      return res.json({
        success: true,
        analysis: {
          pair,
          timeframes,
          visionAnalysis,
          imagesAnalyzed: files.length,
          analysisDate: new Date().toISOString(),
          bloque: true,
          raison: cal.detail
        },
        recommendations: {
          action: 'HOLD',
          reason: cal.detail,
          confidence: 'low',
          entry: {},
          nextSteps: [],
          risk: 'high'
        }
      });
    }

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

    const historyId = newId('hist_');
    await appendHistory({
      id: historyId,
      pair,
      timeframes,
      action: plan.action,
      confidence: plan.confidence,
      reason: plan.reason,
      strategiesUsed: recommendations.strategiesUsed,
      timestamp: analysis.analysisDate
    });
    // Référence stable : permet de rattacher un trade à l'analyse qui l'a produit
    analysis.analysisId = historyId;

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

  // Définitions des termes réellement en jeu, injectées dans la consigne. Sans
  // elles, le modèle emploie « order block » ou « premium » à tort et à travers ;
  // avec elles, il sait qu'une zone de demande prise par le haut en premium
  // n'est pas un achat. On n'injecte QUE les concepts convoqués (8 au plus) :
  // les 32 définitions d'un coup noieraient le modèle.
  const texteAnalyse = [
    visionAnalysis,
    ...strategies.map(s => `${s.title} ${(s.structured?.concepts || []).join(' ')} ${(s.content || '').slice(0, 400)}`)
  ].join(' ');
  const conceptsBlock = Concepts.pourConsigne(texteAnalyse, 8);

  const prompt = `Tu es un analyste trading senior. Tu dois combiner les stratégies de la base avec l'analyse visuelle actuelle et produire un PLAN D'ACTION concret.

PAIRE: ${pair}
TIMEFRAMES: ${timeframes.join(', ')}

=== ANALYSE VISUELLE DES GRAPHIQUES ===
${visionAnalysis}

=== STRATÉGIES DISPONIBLES DANS LA BASE ===
${strategiesBlock}

=== DÉFINITIONS DES TERMES EN JEU (à respecter à la lettre) ===
${conceptsBlock || 'aucune définition particulière'}

=== CONSIGNES ===
- N'emploie un terme technique que s'il figure dans les définitions ci-dessus, et seulement s'il est présent dans l'analyse visuelle.
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

  // ── CACHE DE PLAN IA ──────────────────────────────────────────────────
  // Une même analyse relancée (même paire, mêmes unités de temps, même lecture
  // visuelle, mêmes stratégies) redonnait exactement le même plan — et repayait
  // les tokens. Le cache est indexé sur le PROMPT EXACT (empreinte SHA-1) : deux
  // appels identiques ne coûtent qu'une fois. TTL court (30 min) parce qu'un
  // plan est daté : au-delà, le contexte de marché a bougé.
  const empreinte = crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 20);
  const hit = cachePlan.get(empreinte);
  if (hit && (Date.now() - hit.at) < CACHE_PLAN_TTL_MS) {
    return { ...hit.plan, _cache: true };
  }

  const out = await deepseek([{ role: 'user', content: prompt }], { maxTokens: PLAN_MAX_TOKENS, json: true, route: 'plan-analyse' });
  const plan = JSON.parse(out);
  // Mémorise pour les répétitions. Map bornée : on jette la plus ancienne.
  cachePlan.set(empreinte, { at: Date.now(), plan });
  if (cachePlan.size > CACHE_PLAN_MAX) {
    cachePlan.delete(cachePlan.keys().next().value);
  }
  return plan;
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

    // Vérification du risque de portefeuille avant d'ouvrir la position
    const capital = Number(req.body.capital) || 10000;
    const limitePct = Number(req.body.limiteRisquePct) || 5;
    const positionsExistantes = (await DB.listTrades()).filter(t => t.status === 'open');
    const nouvelleRisquePct = trade.risk && trade.size
      ? (trade.risk * trade.size / capital) * 100
      : 0;

    const verification = peutOuvrirPosition({
      positionsExistantes,
      capital,
      nouvelleRisquePct,
      limitePct
    });

    if (!verification.ok) {
      return res.status(400).json({ error: verification.raison, risqueTotalPct: verification.risqueTotalPct });
    }

    // Vérification de la protection drawdown
    const allTrades = await DB.listTrades();
    const closedTrades = allTrades.filter(t => t.status === 'closed');
    const equityCurve = courbeEquity(closedTrades, capital);
    const { drawdownPct } = calculerDrawdown(equityCurve);
    const ajustement = ajusterRisque({ trades: allTrades, drawdownPct });

    if (ajustement.bloque) {
      return res.status(400).json({ error: ajustement.raison, drawdownPct, niveau: ajustement.niveau });
    }

    await DB.saveTradeRecord(trade);
    res.json({ success: true, trade, risquePortefeuille: verification });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Dashboard temps réel ───
app.get('/api/dashboard', requireAuth, async (req, res) => {
  try {
    const capital = Number(req.query.capital) || 10000;
    const trades = await DB.listTrades();
    const signals = []; // serait rempli par le moteur de signaux
    const dashboard = await buildDashboard({ trades, signals, capital });
    res.json({ success: true, dashboard });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Volume Profile ───
app.get('/api/volume-profile', requireAuth, async (req, res) => {
  try {
    const { symbol, tf, count } = req.query;
    const { candles } = await Market.getCandles(symbol || 'BTCUSDT', tf || '1h', Number(count) || 200);
    const vp = volumeProfile(candles);
    const niveaux = niveauxVolume(vp);
    const gaps = gapsVolume(vp);
    res.json({ success: true, volumeProfile: vp, niveaux, gaps });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Force des devises ───
app.get('/api/currency-strength', requireAuth, async (req, res) => {
  try {
    const { pairs } = req.query;
    const symbolList = pairs ? pairs.split(',') : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];
    const parPaire = {};
    for (const symbol of symbolList) {
      try {
        const { candles } = await Market.getCandles(symbol, '1h', 100);
        parPaire[symbol] = candles;
      } catch { /* paire indisponible */ }
    }
    const forces = forceDevises(parPaire);
    const classees = classeDevises(forces);
    const paireForte = paireLaPlusForte(forces);
    const matrice = matriceCorrelation(forces);
    res.json({ success: true, forces, classees, paireForte, matrice });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── London Breakout ───
app.get('/api/london-breakout', requireAuth, async (req, res) => {
  try {
    const { symbol, tf } = req.query;
    const { candles } = await Market.getCandles(symbol || 'BTCUSDT', tf || '1h', 200);
    const range = rangeAsiatique(candles);
    const breakout = londonBreakout(candles);
    const qualite = evaluerQualite(breakout, candles);
    res.json({ success: true, range, breakout, qualite });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Divergences ───
app.get('/api/divergences', requireAuth, async (req, res) => {
  try {
    const { symbol, tf } = req.query;
    const { candles } = await Market.getCandles(symbol || 'BTCUSDT', tf || '1h', 200);
    const divergencesRSI = detecterDivergences(candles);
    const divergencesMACD = detecterDivergencesMACD(candles);
    res.json({ success: true, rsi: divergencesRSI, macd: divergencesMACD });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Ajustement dynamique du risque ───
app.get('/api/dynamic-risk', requireAuth, async (req, res) => {
  try {
    const { symbol, tf } = req.query;
    const { candles } = await Market.getCandles(symbol || 'BTCUSDT', tf || '1h', 200);
    const ajustement = ajusterRisqueATR(candles);
    const conditions = conditionsFavorables(candles);
    res.json({ success: true, ajustement, conditions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Backtesting visuel ───
// Le backtest vit plus bas (`GET/POST /api/backtest`, section « BACKTEST ») :
// il rejoue le moteur MULTI-SIGNAUX et enregistre les issues avec la même
// fonction que le journal. Il y avait ici une seconde implémentation, limitée
// au verdict unique de `Signals.detect` : sur BTCUSDT 1h elle annonçait
// 0 trade ET +10,02 % de rendement — un chiffre impossible, affiché tel quel.
// Deux backtests qui se contredisent valent moins qu'un seul qui rend des comptes.

// ─── COT Report ───
app.get('/api/cot', requireAuth, async (req, res) => {
  try {
    const { symbol } = req.query;
    const cot = await getCOT(symbol || 'EUR');
    const analyse = analyserCOT(cot);
    res.json({ success: true, cot, analyse });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Taux d'intérêt ───
app.get('/api/interest-rates', requireAuth, async (req, res) => {
  try {
    const taux = await getTauxInteret();
    const classe = classeTaux(taux);
    res.json({
      success: true, taux, classe,
      source: 'valeurs de référence — brancher les API des banques centrales pour du temps réel'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Pattern Recognition ───
app.get('/api/patterns', requireAuth, async (req, res) => {
  try {
    const { symbol, tf } = req.query;
    const { candles } = await Market.getCandles(symbol || 'BTCUSDT', tf || '1h', 200);
    const patterns = detecterPatterns(candles);
    res.json({ success: true, patterns });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Signal Scoring ML ───
app.get('/api/signal-scoring', requireAuth, async (req, res) => {
  try {
    const trades = await DB.listTrades();
    const modele = entrainerModele(trades);
    const metrics = evaluerModele(modele, trades);
    res.json({ success: true, modele, metrics });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Order Flow ───
app.get('/api/order-flow', requireAuth, async (req, res) => {
  try {
    const { symbol, tf } = req.query;
    const { candles } = await Market.getCandles(symbol || 'BTCUSDT', tf || '1h', 200);
    const orderFlow = analyserOrderFlow(candles);
    res.json({ success: true, orderFlow });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Anomaly Detection ───
app.get('/api/anomalies', requireAuth, async (req, res) => {
  try {
    const { symbol, tf } = req.query;
    const { candles } = await Market.getCandles(symbol || 'BTCUSDT', tf || '1h', 200);
    const anomalies = analyserAnomalies(candles);
    res.json({ success: true, anomalies });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Multi-comptes ───
app.get('/api/accounts', requireAuth, async (req, res) => {
  try {
    const comptes = await listerComptes();
    res.json({ success: true, comptes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/accounts', requireAuth, async (req, res) => {
  try {
    const compte = await creerCompte(req.body);
    res.status(201).json({ success: true, compte });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.patch('/api/accounts/:id', requireAuth, async (req, res) => {
  try {
    const compte = await mettreAJourCapital(req.params.id, req.body.capital);
    res.json({ success: true, compte });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/accounts/:id', requireAuth, async (req, res) => {
  try {
    await supprimerCompte(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/accounts/:id/pnl', requireAuth, async (req, res) => {
  try {
    const stats = await pnlCompte(req.params.id);
    res.json({ success: true, stats });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Export PDF / CSV enrichi ───
app.get('/api/export/pdf', requireAuth, async (req, res) => {
  try {
    const trades = await DB.listTrades();
    const html = genererRapportPDF({ trades, titre: req.query.titre || undefined });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="5trade-rapport.html"');
    res.send(html);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/export/csv', requireAuth, async (req, res) => {
  try {
    const trades = await DB.listTrades();
    const csv = genererCSVEnrichi(trades);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="5trade-journal.csv"');
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Alertes push ───
app.get('/api/push/config', requireAuth, async (req, res) => {
  res.json({
    success: true,
    pret: vapidPret(),
    clePublique: process.env.VAPID_PUBLIC_KEY || null,
    abonnes: Alerts.listerAbonnements().length
  });
});

app.post('/api/push/subscribe', requireAuth, async (req, res) => {
  try {
    Alerts.ajouterAbonnement(req.body && req.body.subscription);
    res.json({ success: true, message: 'Abonnement push enregistré' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/push/subscribe', requireAuth, async (req, res) => {
  try {
    if (req.body && req.body.endpoint) Alerts.retirerAbonnement(req.body.endpoint);
    res.json({ success: true });
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

// Téléchargement du journal (le navigateur envoie le cookie HttpOnly)
app.get('/api/trades/export', requireAuth, async (req, res) => {
  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    const list = await DB.listTrades();
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="5trade-journal-${stamp}.json"`);
      return res.send(JSON.stringify(list, null, 2));
    }
    if (format !== 'csv') {
      return res.status(400).json({ error: '« format » doit être csv ou json' });
    }
    // BOM : Excel/LibreOffice reconnaissent l'UTF-8
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="5trade-journal-${stamp}.csv"`);
    res.send('\uFEFF' + Export.toCsv(list));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
// RECHERCHE PLEIN-TEXTE (base de connaissance)
// ─────────────────────────────────────────────────────────────
app.get('/api/search', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Paramètre « q » requis' });
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const all = await loadAllStrategies();
    const results = Search.search(all, q, { limit });
    res.json({ success: true, query: q, count: results.length, results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
// MARCHÉ TEMPS RÉEL + ANALYSE SUR DONNÉES EXACTES
// ─────────────────────────────────────────────────────────────

// État du fournisseur de données (disponibilité réelle, pas déclarative)
app.get('/api/market/status', requireAuth, async (req, res) => {
  try {
    const status = Market.providerStatus();
    const probe = await Market.probe(status.provider);
    res.json({ success: true, ...status, ready: probe.ok, probe });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/market/symbols', requireAuth, (req, res) => {
  res.json({ success: true, symbols: Market.listSymbols(), timeframes: Market.TIMEFRAMES });
});

// Bougies OHLCV exactes (REST puis buffer live)
/**
 * Flux de TICKS bruts : chaque prix, dès qu'il est publié.
 * Distinct de /api/market/stream, qui n'envoie que des bougies (un OHLC en
 * cours de constitution). Ici on transmet la transaction telle quelle.
 */
app.get('/api/market/ticks', requireAuth, (req, res) => {
  const symbol = String(req.query.symbol || '').trim();
  const provider = String(req.query.provider || '').trim() || undefined;
  if (!symbol) return res.status(400).json({ error: 'Paramètre « symbol » requis' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  let stop;
  try {
    stop = Market.watchTicks(symbol, tick => {
      res.write(`event: tick\ndata: ${JSON.stringify(tick)}\n\n`);
    }, provider);
  } catch (e) {
    // Source sans flux de ticks : on le dit, plutôt que de laisser un flux muet.
    res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
    return res.end();
  }
  req.on('close', () => { if (stop) stop(); });
});

/**
 * Alertes : prévenir HORS de la page quand un signal se confirme.
 * L'utilisateur ne peut pas rester devant l'onglet : sans ça, un signal
 * confirmé passe inaperçu.
 */
app.get('/api/alerts', requireAuth, (req, res) => {
  const c = Alerts.get();
  res.json({ success: true, config: c, historique: c.derniers || [] });
});

app.put('/api/alerts', requireAuth, (req, res) => {
  try {
    const c = Alerts.update(req.body || {});
    Alerts.start();                    // applique tout de suite le nouvel intervalle
    res.json({ success: true, config: c });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

/** Contrôle immédiat, sans attendre le prochain cycle. */
app.post('/api/alerts/verifier', requireAuth, async (req, res) => {
  try {
    const r = await Alerts.verifier(true);
    res.json({ success: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * Trouve l'identifiant de la conversation Telegram.
 *
 * L'utilisateur n'a qu'à écrire à son bot : on lit getUpdates et on renvoie la
 * conversation qui vient de lui parler. Sans cela il devrait pêcher cet
 * identifiant à la main dans une URL d'API — ce que personne ne fait.
 */
app.post('/api/alerts/telegram/trouver', requireAuth, async (req, res) => {
  try {
    const jeton = String((req.body && req.body.token) || Alerts.get().telegramToken || '').trim();
    if (!jeton) return res.status(400).json({ error: 'Donne d\'abord le jeton du bot (donné par BotFather).' });

    const r = await fetch(`https://api.telegram.org/bot${jeton}/getUpdates?timeout=0`, {
      signal: AbortSignal.timeout(10000) // 10s max
    });
    const d = await r.json().catch(() => ({}));
    if (!d.ok) {
      return res.status(400).json({
        error: `Telegram refuse ce jeton (${d.description || 'HTTP ' + r.status}). Vérifie qu'il est complet et sans espace.`
      });
    }

    const chats = [];
    for (const maj of (d.result || [])) {
      const msg = maj.message || maj.edited_message || maj.channel_post;
      if (msg && msg.chat && !chats.some(x => String(x.id) === String(msg.chat.id))) {
        chats.push({
          id: msg.chat.id,
          nom: msg.chat.title || [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ')
            || (msg.chat.username ? '@' + msg.chat.username : '') || 'conversation'
        });
      }
    }
    if (!chats.length) {
      return res.json({
        success: true, trouve: false,
        aide: 'Aucune conversation pour l\'instant. Ouvre Telegram, cherche ton bot, envoie-lui « salut », puis clique à nouveau.'
      });
    }
    res.json({ success: true, trouve: true, chats });
  } catch (e) {
    res.status(500).json({ error: `Impossible de joindre Telegram : ${e.message}` });
  }
});

/** Test d'envoi : vérifie que les canaux configurés fonctionnent vraiment. */
app.post('/api/alerts/test', requireAuth, async (req, res) => {
  try {
    const c = Alerts.get();
    const canal = String((req.body && req.body.canal) || 'email');

    // Telegram : un vrai message. Un jeton valide ne prouve rien — il faut que le
    // message arrive sur le téléphone.
    if (canal === 'telegram') {
      if (!c.telegramToken) return res.status(400).json({ error: 'Jeton du bot manquant.' });
      if (!c.telegramChat) {
        return res.status(400).json({ error: 'Conversation manquante : clique d\'abord sur « Trouver ma conversation ».' });
      }
      const r = await fetch(`https://api.telegram.org/bot${c.telegramToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: c.telegramChat,
          text: '<b>5trade — test</b>\n\nSi tu lis ce message, les alertes Telegram '
            + 'fonctionnent. Tu recevras ici chaque signal confirmé, une seule fois par signal.',
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }),
        signal: AbortSignal.timeout(15000) // 15s max
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) {
        return res.status(400).json({
          error: `Telegram refuse l'envoi (${d.description || 'HTTP ' + r.status}). `
            + 'Vérifie le jeton et la conversation.'
        });
      }
      return res.json({ success: true, canal: 'telegram',
        message: 'Message envoyé : regarde ton téléphone.' });
    }

    const to = c.email || (req.account && req.account.email) || (account && account.email);
    if (!to) return res.status(400).json({ error: 'Aucun destinataire : renseigne une adresse email' });
    await sendMail({
      to,
      subject: '[5trade] Test d\'alerte',
      html: `<div style="font-family:system-ui,sans-serif;background:#0b1017;color:#e2e8f0;padding:20px;border-radius:12px">
        <h2 style="margin:0 0 8px;color:#34d399">Alertes opérationnelles</h2>
        <p style="color:#94a3b8;font-size:13.5px;margin:0">
          Ce message confirme que 5trade peut te prévenir par email quand un signal
          se confirme sur les marchés surveillés. Aucune action requise.</p></div>`
    });
    res.json({ success: true, to });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/market/candles', requireAuth, async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim();
    const tf = String(req.query.tf || '5m').trim();
    const count = Math.min(parseInt(req.query.count || '300', 10) || 300, 1000);
    if (!symbol) return res.status(400).json({ error: 'Paramètre « symbol » requis' });
    const provider = String(req.query.provider || '').trim() || undefined;
    const r = await Market.getCandles(symbol, tf, count, provider);
    res.json({ success: true, symbol, timeframe: tf, ...r });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Analyse structurelle chiffrée (aucun modèle : que du calcul)
app.get('/api/market/structure', requireAuth, async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim();
    const tf = String(req.query.tf || '5m').trim();
    const count = Math.min(parseInt(req.query.count || '300', 10) || 300, 1000);
    if (!symbol) return res.status(400).json({ error: 'Paramètre « symbol » requis' });
    const prov = String(req.query.provider || '').trim() || undefined;
    const { candles, provider, source, offline } = await Market.getCandles(symbol, tf, count, prov);
    // Marché fermé (week-end, hors séance) = quelques bougies seulement. Ce n'est
    // pas une erreur : on renvoie 200 avec l'information, sinon le graphique
    // restait vide alors que les bougies existent.
    if (candles.length < 20) {
      return res.json({
        success: true, symbol, timeframe: tf, provider, source, offline: !!offline,
        insufficient: true, candles: candles.length, report: null,
        note: `Seulement ${candles.length} bougie(s) : marché fermé ou hors séance. `
          + `L'analyse demande 20 bougies minimum. Les indices synthétiques (Volatility) `
          + `et les cryptos cotent 24 h/24.`
      });
    }
    const report = Structure.analyze(candles, { symbol, timeframe: tf });
    // Le vocabulaire évalué accompagne le rapport : chaque terme avec ce que CE
    // graphique montre, pour que le raisonnement soit vérifiable brique par brique.
    res.json({
      success: true, symbol, timeframe: tf, provider, source, offline: !!offline,
      report,
      vocabulaire: Structure.vocabulaire(report),
      // Avancement de chaque type de trade : prérequis remplis, étapes
      // franchies, et le point exact qui bloque. C'est la réponse à « qu'est-ce
      // qui manque pour un signal », au lieu d'un verdict opaque.
      playbooks: Playbooks.tous(report)
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Avancement d'un type de trade précis (ou des quatre)
app.get('/api/playbooks', requireAuth, async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim();
    if (!symbol) return res.status(400).json({ error: 'Paramètre « symbol » requis' });
    const tf = String(req.query.tf || '5m').trim();
    const type = String(req.query.type || '').trim();
    const provider = String(req.query.provider || '').trim() || undefined;
    const { candles, provider: p } = await Market.getCandles(symbol, tf, 300, provider);
    const closes = (candles || []).filter(c => c.closed !== false);
    if (closes.length < 20) {
      return res.json({ success: true, symbol, type: type || null, playbooks: [],
        note: 'Pas assez de bougies (marché fermé ou historique trop court).' });
    }
    const report = Structure.analyze(closes, { symbol, timeframe: tf });
    const playbooks = type && Playbooks.TYPES[type]
      ? [Playbooks.evaluer(report, type)]
      : Playbooks.tous(report);
    res.json({ success: true, symbol, timeframe: tf, provider: p,
      types: Object.values(Playbooks.TYPES), playbooks });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Séries disponibles hors ligne (issue de secours quand le réseau tombe)
app.get('/api/market/cache', requireAuth, (req, res) => {
  res.json({ success: true, ...Market.cacheInfo() });
});

// Suivi temps réel (Server-Sent Events) — la bougie en cours arrive en continu
app.get('/api/market/stream', requireAuth, (req, res) => {
  const symbol = String(req.query.symbol || '').trim();
  const tf = String(req.query.tf || '5m').trim();
  const provider = String(req.query.provider || '').trim() || undefined;
  if (!symbol) return res.status(400).json({ error: 'Paramètre « symbol » requis' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  let stop;
  try {
    stop = Market.watch(symbol, tf, candle => {
      res.write(`event: candle\ndata: ${JSON.stringify(candle)}\n\n`);
    }, provider);
  } catch (e) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
    return res.end();
  }
  res.write(`event: hello\ndata: ${JSON.stringify({ symbol, tf, provider: Market.activeProvider() })}\n\n`);

  const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
  req.on('close', () => { clearInterval(keepAlive); try { stop(); } catch {} });
});

// Analyse complète : structure calculée + base de connaissance + plan
// Le modèle rédige à partir de NOMBRES exacts (pas d'une capture).
app.post('/api/market/analyze', requireAuth, async (req, res) => {
  try {
    const symbol = String(req.body.symbol || '').trim();
    const tf = String(req.body.tf || '5m').trim();
    const maxStrategies = parseInt(req.body.maxStrategies || '3', 10);
    if (!symbol) return res.status(400).json({ error: 'Paramètre « symbol » requis' });

    const prov = String(req.body.provider || '').trim() || undefined;
    const { candles, provider, source, offline } = await Market.getCandles(symbol, tf, 300, prov);
    const report = Structure.analyze(candles, { symbol, timeframe: tf });

    const all = await loadAllStrategies();
    const matched = searchKnowledgeBase(all, { pair: symbol, timeframes: [tf], visionAnalysis: report.summary });
    const top = matched.slice(0, maxStrategies);

    let plan;
    try {
      plan = await buildPlan({ pair: symbol, timeframes: [tf], visionAnalysis: report.summary, strategies: top });
    } catch (e) {
      plan = { action: 'HOLD', reason: 'Combinaison indisponible: ' + e.message, confidence: 'low', entry: {}, nextSteps: [], risk: 'medium' };
    }

    const analysis = {
      mode: 'live',
      symbol, pair: symbol, timeframe: tf,
      provider, source,
      dataPoints: candles.length,
      lastPrice: report.lastPrice,
      atr14: report.atr14,
      structure: report.structure,
      levels: report.levels,
      premiumDiscount: report.premiumDiscount,
      fvgs: report.fvgs,
      orderBlocks: report.orderBlocks,
      liquidity: report.liquidity,
      summary: report.summary,
      analysisDate: new Date().toISOString()
    };

    const recommendations = {
      ...plan,
      strategiesUsed: top.map(s => ({
        id: s.id, title: s.title, type: s.type, source: s.source, relevanceScore: s.relevanceScore
      })),
      candidatesFound: matched.length
    };

    const historyId = newId('hist_');
    await appendHistory({
      id: historyId, mode: 'live', pair: symbol, timeframes: [tf],
      action: plan.action, confidence: plan.confidence, reason: plan.reason,
      strategiesUsed: recommendations.strategiesUsed, timestamp: analysis.analysisDate
    });
    analysis.analysisId = historyId;

    res.json({ success: true, analysis, recommendations });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
// SIGNAUX — verdict exploitable + alertes en direct
// ─────────────────────────────────────────────────────────────

/** Stratégies de la base qui correspondent au signal (pour dire « laquelle s'applique »). */
/**
 * Stratégies de la base cohérentes avec le verdict.
 *
 * Remplace la recherche plein-texte : celle-ci remontait toute stratégie dont le
 * texte contenait un mot du marché (« discount », « haussier »), ce qui affichait
 * des stratégies de liquidité alors que l'utilisateur avait choisi « OB ».
 * Ici on compare les RÈGLES : une stratégie est pertinente si elle active les
 * mêmes familles de règles que celles appliquées. Le score est explicable.
 */
async function strategiesForSignal(verdict) {
  try {
    const all = await loadAllStrategies();
    const declenchees = [...new Set((verdict.rules || []).map(r => r.rule))];
    const actives = verdict.reglesActives || [];
    const appliquee = verdict.strategieAppliquee;

    // Priorité aux règles réellement déclenchées ; à défaut, celles du mode.
    const reference = appliquee && Array.isArray(appliquee.regles) && appliquee.regles.length
      ? appliquee.regles
      : (declenchees.length ? declenchees : actives);
    if (!reference.length) return [];

    const dejaAffichee = appliquee && appliquee.id ? String(appliquee.id) : null;

    return (all || [])
      .filter(s => String(s.id) !== dejaAffichee)
      .map(s => {
        const profil = Signals.profilDepuisStrategie(s);
        const communes = profil.regles.filter(r => reference.includes(r));
        return {
          id: s.id, title: s.title, type: s.type,
          regles: profil.regles,
          communes,
          pertinence: Math.round((communes.length / reference.length) * 100)
        };
      })
      .filter(x => x.communes.length > 0)
      .sort((a, b) => b.pertinence - a.pertinence || b.communes.length - a.communes.length)
      .slice(0, 4);
  } catch { return []; }
}

// Verdict ponctuel sur la dernière bougie clôturée
/**
 * Profils d'analyse : chaque stratégie de la base, avec les règles qu'elle
 * active. C'est ce qui permet d'analyser SELON une stratégie et pas seulement
 * selon un verdict unique.
 */
async function profilsStrategies() {
  const strategies = await loadAllStrategies();
  return (strategies || []).map(x => Signals.profilDepuisStrategie(x));
}

app.get('/api/strategies/profiles', requireAuth, async (req, res) => {
  try {
    const profils = await profilsStrategies();
    res.json({
      success: true,
      reglesDisponibles: Object.keys(Signals.TOUTES_REGLES),
      profils,
      resume: {
        total: profils.length,
        deduits: profils.filter(p => p.deduitDuTexte).length,
        toutesRegles: profils.filter(p => !p.deduitDuTexte).length
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Lexique personnalisé : les termes que l'utilisateur ajoute lui-même ───
app.get('/api/termes', requireAuth, (req, res) => {
  try { res.json({ success: true, termes: Lexique.lister(), familles: Lexique.FAMILLES }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/termes', requireAuth, (req, res) => {
  try { res.json({ success: true, terme: Lexique.ajouter(req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/termes/:id', requireAuth, (req, res) => {
  try { res.json({ success: true, terme: Lexique.modifier(req.params.id, req.body || {}) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/termes/:id', requireAuth, (req, res) => {
  try { res.json({ success: true, ...Lexique.supprimer(req.params.id) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Base de concepts du moteur : les définitions injectées dans l'analyse ───
// Elles ne sont pas décoratives : l'analyse IA les reçoit avant de conclure.
app.get('/api/concepts', requireAuth, (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q) {
      return res.json({ success: true, concepts: Concepts.chercher(q), categories: Concepts.CATEGORIES });
    }
    const cat = String(req.query.categorie || '').trim() || undefined;
    res.json({
      success: true,
      concepts: Concepts.tous(cat),
      categories: Concepts.CATEGORIES,
      total: Concepts.CONCEPTS.length
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Décrire une stratégie : le trader l'explique, le moteur la structure ───
// « Je lui explique une stratégie, il analyse, rassemble les infos et me la
//  rend en la sauvegardant. » Le résultat n'est pas un texte : c'est une fiche
// exploitable, avec le moteur qui décide comment analyser.
// Un trader colle un cours complet, pas trois lignes. La limite précédente
// (40 000) refusait un document pourtant légitime et obligeait l'utilisateur à
// découper à la main — ce que la machine doit faire elle-même.
const LIMITE_DESCRIPTION = 200000;

/**
 * Découpe un document trop long en sections autonomes.
 *
 * Un cours entier mélange plusieurs stratégies : en tirer UN seul profil donne un
 * moteur bâtard qui ne correspond à rien. On coupe donc aux titres — lignes
 * courtes, numérotations, « Étape », « Setup », majuscules — et chaque section
 * devient une fiche. Les sections encore trop grosses sont recoupées par paquets.
 */
function decouperEnSections(texte, maxParFiche = 15000) {
  const estTitre = l => {
    const t = String(l || '').trim();
    if (!t || t.length > 90) return false;
    if (/^(#{1,4}\s|chapitre|section|partie|module|etape|étape|setup|strategie|stratégie)/i.test(t)) return true;
    if (/^\d+[.)]\s+\S/.test(t)) return true;
    return t.length < 60 && t === t.toUpperCase() && /[A-ZÀ-Ý]{4}/.test(t);
  };
  const sections = [];
  let bloc = [];
  for (const ligne of String(texte).split(/\r?\n/)) {
    if (estTitre(ligne) && bloc.join('\n').trim().length > 400) {
      sections.push(bloc.join('\n').trim());
      bloc = [];
    }
    bloc.push(ligne);
  }
  if (bloc.join('\n').trim()) sections.push(bloc.join('\n').trim());

  const sorties = [];
  for (const s of sections) {
    if (s.length <= maxParFiche) { sorties.push(s); continue; }
    // Section encore trop longue : on coupe sur les mots, jamais au milieu d'un.
    const mots = s.split(/\s+/);
    let paquet = [];
    for (const m of mots) {
      if (paquet.join(' ').length + m.length + 1 > maxParFiche) { sorties.push(paquet.join(' ')); paquet = []; }
      paquet.push(m);
    }
    if (paquet.length) sorties.push(paquet.join(' '));
  }
  return sorties.filter(s => s.length >= 300);
}

/**
 * Transforme UN texte de strategie en fiche exploitable, sans l'enregistrer.
 * Sortie de la route pour pouvoir traiter plusieurs sections d'un document.
 */
async function structurerTexte(texte) {
  try {
  const consigne = `Tu transformes la description d'un trader en FICHE DE STRATÉGIE exploitable par un moteur d'analyse.

DESCRIPTION DU TRADER :
"""${texte}"""

RÈGLES DISPONIBLES (choisis uniquement celles qui correspondent réellement à ce qu'il décrit) :
  R1 = balayage de liquidité (mèche au-delà d'un niveau puis retour)
  R2 = rupture de structure (BOS / CHoCH, cassure confirmée par la clôture)
  R3 = zone réactive (order block, FVG, breaker : le prix réagit sur une zone)
  R4 = position dans le range (premium pour vendre, discount pour acheter)

ATTENTION : il n'existe QUE ces quatre règles. N'invente pas d'identifiant, et ne
mets jamais « R5 » ni « sens de la structure » dans la liste des règles : le sens de
la structure est un CONTEXTE, pas une confirmation (voir les filtres ci-dessous —
c'est le filtre « structure »). Une règle doit être une observation du graphique,
pas une répétition du sens du signal.

FILTRES (conditions qui ne donnent pas de sens mais dont l'absence invalide) :
  volatilite = la stratégie exige une amplitude exploitable
  session    = elle exige une session active (Londres / New York)
  range      = elle exige un range clairement borné
  structure = elle exige une structure directionnelle nette (ni range, ni indécise).
              C'est ici que se dit « je ne prends que dans le sens de la structure ».

STYLES (choisis-en un si c'est indiqué, sinon null) :
  scalping = quelques minutes (1m / 5m / 15m)
  intraday = la journée (5m / 15m / 1h)
  swing    = plusieurs jours (1h / 4h / 1d)

Réponds en JSON strict, sans texte autour :
{
  "titre": "titre court et parlant, 60 caractères max",
  "resume": "2 ou 3 phrases qui résument la logique de la stratégie",
  "regles": ["R1","R3"],
  "filtres": ["volatilite"],
  "style": "scalping" | "intraday" | "swing" | null,
  "timeframes": ["1m","5m","15m"],
  "seuilAlignes": 2,
  "seuilForce": 0.5,
  "entree": "condition d'entrée, précise et vérifiable",
  "invalidation": "ce qui annule le scénario",
  "objectif": "où prendre le profit",
  "contexte": "quand NE PAS trader",
  "concepts": ["OB","FVG","Sweep"],
  "motsCles": ["3 à 6 mots-clés pour retrouver la fiche"]
}
N'invente rien : si une information n'est pas dans la description, mets null ou une liste vide.`;

  let fiche;
  try {
    const out = await deepseek([{ role: 'user', content: consigne }], { maxTokens: 2000, json: true, route: 'description-strategie' });
    fiche = JSON.parse(out);
  } catch (e) {
    throw new Error(`L'analyse du texte a échoué (${e.message}).`)
  }

  // Le moteur est normalisé : aucune valeur hors bornes n'entre en base.
  const reglesConnues = Array.isArray(fiche.regles)
    ? fiche.regles.map(r => String(r).toUpperCase()).filter(r => Signals.TOUTES_REGLES[r]) : [];
  // Un style déclaré impose ses unités de temps si le trader n'en a pas donné
  // assez : « scalping » sur une seule unité ne produirait aucun alignement,
  // donc aucun signal fiable — exactement ce qu'on cherche à éviter.
  const tfIA = Array.isArray(fiche.timeframes) ? fiche.timeframes.filter(t => /^\d+[mhd]$/.test(String(t))) : [];
  const tfStyle = (fiche.style && Signals.STYLES[fiche.style])
    ? Signals.STYLES[fiche.style].timeframes : [];
  const timeframes = (tfIA.length >= 2 ? tfIA : (tfIA.length && tfStyle.length ? tfStyle : tfIA)) || null;
  const moteur = Signals.normaliserMoteur({
    regles: reglesConnues,
    // Filtres proposes par l'IA : conditions exigees par la strategie.
    filtres: Array.isArray(fiche.filtres) ? fiche.filtres : [],
    style: fiche.style || null,
    timeframes,
    seuilAlignes: fiche.seuilAlignes,
    seuilForce: fiche.seuilForce
  });

  const titre = String(fiche.titre || 'Stratégie décrite').slice(0, 90);
  const contenu = [
    fiche.resume || '',
    fiche.entree ? `Entrée : ${fiche.entree}` : '',
    fiche.invalidation ? `Invalidation : ${fiche.invalidation}` : '',
    fiche.objectif ? `Objectif : ${fiche.objectif}` : '',
    fiche.contexte ? `À éviter : ${fiche.contexte}` : '',
    '',
    '--- description d\'origine ---',
    texte
  ].filter(Boolean).join('\n');

  const strategy = {
    id: newId('man_'),
    title: titre,
    content: contenu,
    type: 'strategy',
    source: 'decrite',
    tags: (Array.isArray(fiche.motsCles) ? fiche.motsCles : []).map(String).slice(0, 12),
    structured: {
      summary: fiche.resume || '',
      concepts: Array.isArray(fiche.concepts) ? fiche.concepts.map(String).slice(0, 12) : [],
      conditions: fiche.contexte || '',
      rules: { entree: fiche.entree || null, invalidation: fiche.invalidation || null, objectif: fiche.objectif || null }
    },
    moteur,
    createdAt: new Date().toISOString()
  };


  const profil = Signals.profilDepuisStrategie(strategy);
  return {
    success: true,
    // C'est l'appelant qui decide d'enregistrer : la fonction ne fait que
    // structurer le texte, elle ne touche ni a la requete ni a la base.
    enregistree: true,
    strategy,
    moteur,
    profil,
    fiche,
    lecture: `Règles ${(profil.regles || []).join(' + ') || 'toutes'}`
      + (profil.style ? ` · style ${profil.style}` : '')
      + (profil.timeframes ? ` · unités ${profil.timeframes.join('/')}` : '')
      + (profil.seuilAlignes ? ` · alignement sur ${profil.seuilAlignes}` : '')
  };
  } catch (e) { throw e; }
}

app.post('/api/strategies/decrire', requireAuth, async (req, res) => {
  try {
    const texte = String((req.body && req.body.texte) || '').trim();
    if (texte.length < 30) {
      return res.status(400).json({ error: 'Décris ta stratégie en quelques phrases (30 caractères minimum).' });
    }
    // Un cours complet, un PDF collé, plusieurs pages de règles : c'est ce qu'un
    // trader apporte réellement. On accepte donc un document, pas seulement une
    // note de trois paragraphes.
    if (texte.length > LIMITE_DESCRIPTION) {
      return res.status(400).json({
        error: `Document trop long : ${texte.length} caractères, maximum ${LIMITE_DESCRIPTION}.`
          + ' Réessaie avec la partie qui t\'intéresse, ou découpe-le en deux documents.'
      });
    }


    // Un document long est découpé : chaque section devient SA propre fiche.
    // Un cours entier mélange plusieurs stratégies ; en tirer un seul profil
    // donnerait un moteur qui ne correspond à aucune d'elles.
    const sections = texte.length > 25000 ? decouperEnSections(texte) : [texte];
    const liste = sections.length ? sections : [texte];

    const resultats = [];
    const echecs = [];
    for (const section of liste) {
      try {
        resultats.push(await structurerTexte(section));
      } catch (e) {
        // Une section en échec ne doit pas faire perdre les autres.
        echecs.push({ extrait: section.slice(0, 70) + '…', erreur: e.message });
      }
    }
    if (!resultats.length) {
      return res.status(502).json({
        error: `L'analyse du texte a échoué (${echecs[0] ? echecs[0].erreur : 'service d\'IA indisponible'}).`
          + ' Vérifie que le service d\'IA répond, puis réessaie.'
      });
    }

    // Sauvegarde : ce que le trader a expliqué devient utilisable tout de suite.
    const enregistrer = req.body.enregistrer !== false;
    if (enregistrer) for (const r of resultats) await saveStrategy(r.strategy);

    const premier = resultats[0];
    res.json({
      success: true,
      enregistree: enregistrer,
      // Document long : on annonce combien de fiches en sont sorties, et pourquoi.
      nombre: resultats.length,
      decoupe: resultats.length > 1,
      echecs,
      // La première fiche reste exposée à la racine : l'écran n'en affiche qu'une.
      strategy: premier.strategy,
      moteur: premier.moteur,
      profil: premier.profil,
      fiche: premier.fiche,
      lecture: premier.lecture,
      fiches: resultats.map(r => ({
        strategy: r.strategy, moteur: r.moteur, profil: r.profil, fiche: r.fiche, lecture: r.lecture
      }))
    });

  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * Détermine comment analyser :
 *   mode=auto → toutes les règles (l'app combine tout ce qu'elle sait)
 *   mode=manuel + strategies=id1,id2,… → l'UNION des règles de ces stratégies.
 * On peut donc en choisir UNE SEULE ou PLUSIEURS : deux stratégies choisies
 * ensemble ne s'excluent pas, leurs règles se cumulent.
 */
async function optionsAnalyse(src) {
  const mode = String(src.mode || 'auto').toLowerCase();

  // Accepte ?strategies=id1,id2 (le format courant), strategyIds[] et l'ancien
  // ?strategyId= pour ne pas casser un appel existant.
  const brut = src.strategies !== undefined ? src.strategies
    : (src.strategyIds !== undefined ? src.strategyIds : src.strategyId);
  let ids = [];
  if (Array.isArray(brut)) ids = brut.map(String);
  else if (typeof brut === 'string' && brut.trim()) ids = brut.split(',').map(x => x.trim());
  ids = [...new Set(ids.filter(Boolean))];

  if (mode !== 'manuel' || !ids.length) return { mode: 'auto' };

  const strategies = await loadAllStrategies().catch(() => []);
  const profils = ids
    .map(id => (strategies || []).find(x => x.id === id))
    .filter(Boolean)
    .map(doc => Signals.profilDepuisStrategie(doc));

  if (!profils.length) return { mode: 'manuel', strategiesIntrouvables: ids };

  // Union des règles : choisir deux stratégies ne doit pas en écarter une.
  const regles = [...new Set(profils.flatMap(p => p.regles))];
  // Seuils : on garde le plus exigeant de ce que l'utilisateur a choisi.
  const seuilForce = Math.max(...profils.map(p => p.seuilForce || 0.35));
  const seuilRegles = Math.min(Math.max(...profils.map(p => p.seuilRegles || 2)), regles.length);
  // Paramètres de calcul : le premier profil qui en définit.
  const parametres = profils.map(p => p.parametres).find(Boolean) || undefined;
  const titres = profils.map(p => p.titre || p.id);

  // Unités de temps exigées par la ou les stratégies choisies. On retient la
  // liste la plus complète : c'est la stratégie qui décide de son cadre.
  const listes = profils.map(p => p.timeframes).filter(Boolean);
  const timeframes = listes.length ? [...new Set(listes.flat())].slice(0, 5) : null;
  const seuilAlignes = Math.max(...profils.map(p => p.seuilAlignes || 0)) || null;
  const style = profils.map(p => p.style).find(Boolean) || null;
  // Filtres exigés : l'union de ceux des stratégies choisies (un filtre demandé
  // par une stratégie reste exigé même si l'autre ne le demande pas).
  const filtres = [...new Set(profils.flatMap(p => p.filtres || []))];

  return {
    mode: 'manuel',
    regles, seuilForce, seuilRegles, parametres,
    timeframes, seuilAlignes, style, filtres,
    // Les profils COMPLETS, dans l'ordre choisi. `regles` ci-dessus est leur
    // union (pour la confluence et le verdict de synthèse), mais le moteur
    // multi-signaux a besoin de chaque profil SÉPARÉMENT : additionner les règles
    // de cinq stratégies produit un signal qui n'appartient à aucune des cinq.
    profils,
    strategies: profils.map(p => ({ id: p.id, titre: p.titre, regles: p.regles })),
    strategie: {
      titre: titres.join(' + '),
      regles,
      nombre: profils.length,
      timeframes: timeframes || [],
      seuilAlignes,
      style
    }
  };
}

/**
 * Analyse multi-timeframes : le « tir de sniper ». On examine plusieurs unités
 * de temps, on exige leur alignement, et le signal n'est confirmé que si le
 * contexte supérieur va dans le même sens.
 * Le NOMBRE d'unités vient de la stratégie choisie (ou de son style) ; sinon on
 * prend le contexte naturel de l'unité de travail. C'est ce qui rend le moteur
 * adaptatif : une stratégie de scalping ne croise pas les mêmes unités qu'un
 * suivi de tendance.
 */
app.get('/api/signals/confluence', requireAuth, async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim();
    const tfBase = String(req.query.tf || '5m').trim();
    const provider = String(req.query.provider || '').trim() || undefined;
    if (!symbol) return res.status(400).json({ error: 'Paramètre « symbol » requis' });

    const options = await optionsAnalyse(req.query);
    const tfs = ((options.timeframes && options.timeframes.length)
      ? options.timeframes
      : (Signals.TF_SUPERIEURS[tfBase] || [tfBase])).slice(0, 5);

    const parTF = [];
    for (const tf of tfs) {
      try {
        const r = await Market.getCandles(symbol, tf, 300, provider);
        const closes = (r.candles || []).filter(c => c.closed !== false);
        parTF.push(closes.length < 20
          ? { tf, verdict: null }
          : { tf, verdict: Signals.detect(closes, { symbol, timeframe: tf }, options) });
      } catch (e) {
        parTF.push({ tf, verdict: null, erreur: e.message });
      }
    }

    const exploitables = parTF.filter(x => x.verdict);
    if (!exploitables.length) {
      return res.json({
        success: true, symbol, timeframes: tfs, mode: options.mode,
        strategieAppliquee: options.strategie || null,
        verdict: null, confluence: null,
        note: 'Aucune unité de temps ne fournit assez de bougies (marché fermé ou historique trop court).'
      });
    }

    const resultat = Signals.verdictAvecConfluence(exploitables, {
      seuilAlignes: options.seuilAlignes || undefined
    });
    if (resultat.verdict) {
      resultat.verdict.strategies = await strategiesForSignal(resultat.verdict);
    }

    res.json({
      success: true,
      symbol,
      mode: options.mode,
      strategieAppliquee: options.strategie || null,
      timeframes: tfs,
      seuilAlignes: resultat.confluence.seuilAlignes,
      verdict: resultat.verdict,
      confluence: resultat.confluence,
      parTimeframe: exploitables.map(x => ({
        tf: x.tf,
        status: x.verdict.status,
        direction: x.verdict.direction,
        strength: x.verdict.strength,
        tendance: x.verdict.trend,
        regles: (x.verdict.rules || []).map(r => r.rule)
      })),
      insuffisants: parTF.filter(x => !x.verdict).map(x => x.tf)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/signals', requireAuth, async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim();
    const tf = String(req.query.tf || '5m').trim();
    if (!symbol) return res.status(400).json({ error: 'Paramètre « symbol » requis' });
    const prov = String(req.query.provider || '').trim() || undefined;
    const { candles, provider, offline } = await Market.getCandles(symbol, tf, 300, prov);
    const closed = candles.filter(c => c.closed !== false);
    if (closed.length < 20) {
      return res.json({
        success: true, provider, offline: !!offline, dataPoints: closed.length,
        insufficient: true, verdict: null,
        note: `Seulement ${closed.length} bougie(s) clôturée(s) : signal impossible pour l'instant (20 minimum).`
      });
    }
    const options = await optionsAnalyse(req.query);
    const verdict = Signals.detect(closed, { symbol, timeframe: tf }, options);
    verdict.strategies = await strategiesForSignal(verdict);
    verdict.mode = options.mode;
    verdict.strategieAppliquee = options.strategie || null;
    res.json({ success: true, provider, offline: !!offline, dataPoints: closed.length, verdict });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Alertes en direct : évalue à chaque bougie CLÔTURÉE et n'émet que sur changement
app.get('/api/signals/stream', requireAuth, (req, res) => {
  const symbol = String(req.query.symbol || '').trim();
  const tf = String(req.query.tf || '5m').trim();
  const provider = String(req.query.provider || '').trim() || undefined;
  if (!symbol) return res.status(400).json({ error: 'Paramètre « symbol » requis' });
  if (!Market.TF_MS[tf]) return res.status(400).json({ error: `Timeframe inconnu : ${tf}` });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  if (res.flushHeaders) res.flushHeaders();

  let lastKey = null;
  let closed = true;
  // Résolu une seule fois : la stratégie choisie ne change pas pendant le flux.
  let optionsFlux = { mode: 'auto' };
  optionsAnalyse(req.query).then(o => { optionsFlux = o; evaluate(); }).catch(() => {});

  let evaluate = async () => {
    try {
      const { candles } = await Market.getCandles(symbol, tf, 300, provider);
      // On n'analyse QUE des bougies terminées : sinon le verdict clignote
      // à chaque tick et ne veut rien dire.
      const done = candles.filter(c => c.closed !== false);
      if (done.length < 20) {
        if (lastKey !== 'insuffisant') {
          lastKey = 'insuffisant';
          res.write(`event: signal\ndata: ${JSON.stringify({ status: 'indisponible', direction: 'NEUTRE',
            insufficient: true, candles: done.length, at: done.length ? done[done.length - 1].t : null,
            summary: `Données insuffisantes (${done.length} bougie(s)) : marché fermé ou hors séance.` })}\n\n`);
        }
        return;
      }
      const verdict = Signals.detect(done, { symbol, timeframe: tf }, optionsFlux);

      // ── MOTEUR MULTI-SIGNAUX ────────────────────────────────────────
      // Un verdict unique efface les stratégies : cinq stratégies choisies
      // donnaient UN signal qui n'appartenait à aucune. Ici chaque stratégie est
      // évaluée séparément, et chaque motif de bougie devient son propre signal.
      // `structure:false` : le `verdict` ci-dessus porte déjà la lecture SMC, on
      // ne la calcule pas deux fois.
      let multi = null;
      try {
        multi = Multi.detecterTout(done, { symbol, timeframe: tf }, {
          profils: optionsFlux.profils || [],
          // `structure` reste ACTIVÉ : c'est lui qui produit la carte de marché
          // (tendance, BOS/CHoCH, premium/discount, zones) et le contexte de
          // chaque signal. Le désactiver ici vidait la moitié de la lecture.
          // Porte du rapport risque/rendement : optionnelle et chiffrée
          // (`rrMin=1`). Mesurée : elle améliore R_75 sur les trois unités de
          // temps, et dégrade légèrement l'or en 1h — donc pas de défaut imposé.
          rrMin: Number.isFinite(Number(req.query.rrMin)) ? Number(req.query.rrMin) : undefined
        });
      } catch (e) { multi = null; }

      verdict.signaux = multi ? multi.signaux : [];
      verdict.synthese = multi ? multi.synthese : null;
      // La carte de marché (tendance, BOS/CHoCH, premium/discount, zones,
      // liquidité) part avec le flux : l'écran l'affiche en tête.
      verdict.carte = multi ? multi.carte : null;

      // Journal : on persiste les signaux RETENUS (confirmés / à surveiller) qui
      // portent des niveaux. Ils seront réévalués sur les bougies suivantes pour
      // savoir s'ils ont touché leur objectif, leur stop, ou fini au point
      // d'entrée. C'est la seule façon de mesurer si le moteur a raison.
      if (multi) {
        try {
          JournalSignaux.enregistrer(
            multi.signaux.filter(s => s.status === 'confirme' || s.status === 'surveiller'),
            { symbol, timeframe: tf, provider, at: verdict.at }
          );
        } catch { /* le journal ne doit jamais casser le flux */ }
      }

      // La clé de rafraîchissement doit tenir compte des SIGNAUX : sans eux, un
      // motif qui apparaît (marteau, double bottom) ne changeait pas la clé et
      // l'écran ne le voyait jamais arriver.
      const sigKey = multi
        ? multi.signaux.map(s => `${s.id}:${s.status}:${s.force}`).join('~')
        : '';
      const key = [verdict.status, verdict.direction,
                   (verdict.rules || []).map(r => r.rule).sort().join(','), sigKey].join('|');
      if (key !== lastKey) {
        lastKey = key;
        verdict.strategies = await strategiesForSignal(verdict);
      verdict.mode = optionsFlux.mode;
      verdict.strategieAppliquee = optionsFlux.strategie || null;
        verdict.at_price = candles[candles.length - 1].c;
        if (closed) res.write(`event: signal\ndata: ${JSON.stringify(verdict)}\n\n`);
      }
    } catch { /* bougie incomplète ou réseau : on retentera */ }
  };

  evaluate();
  res.write(`event: hello\ndata: ${JSON.stringify({ symbol, tf, provider: Market.activeProvider() })}\n\n`);

  let stop = () => {};
  try {
    stop = Market.watch(symbol, tf, (candle) => { if (candle.closed) evaluate(); }, provider);
  } catch (e) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
    return res.end();
  }
  // Filet : même sans clôture détectée (marché calme, fournisseur sans WS),
  // on réévalue régulièrement.
  const poll = setInterval(evaluate, Math.max(20000, Math.floor((Market.TF_MS[tf] || 60000) / 2)));
  const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);

  req.on('close', () => {
    closed = false;
    clearInterval(poll);
    clearInterval(keepAlive);
    try { stop(); } catch {}
  });
});

// ─────────────────────────────────────────────────────────────
// SIGNAUX MULTIPLES — un signal par stratégie, un par motif
// ─────────────────────────────────────────────────────────────
/**
 * GET /api/signaux?symbol=BTCUSDT&tf=5m&mode=manuel&strategies=id1,id2
 *
 * Rend la LISTE complète des signaux au lieu d'un verdict unique. Coût IA : zéro
 * (moteur local). C'est l'endpoint que consomme l'onglet « Signaux » et celui
 * que la surveillance Telegram réutilise pour n'alerter que sur les signaux
 * réellement confirmés, chacun avec sa stratégie.
 */
app.get('/api/signaux', requireAuth, async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim();
    const tf = String(req.query.tf || '5m').trim();
    const provider = String(req.query.provider || '').trim() || undefined;
    if (!symbol) return res.status(400).json({ error: 'Paramètre « symbol » requis' });
    if (!Market.TF_MS[tf]) return res.status(400).json({ error: `Timeframe inconnu : ${tf}` });

    const { candles } = await Market.getCandles(symbol, tf, 300, provider);
    const done = (candles || []).filter(c => c.closed !== false);
    if (done.length < 20) {
      return res.json({
        symbol, timeframe: tf, signaux: [], motifs: null, structure: null,
        synthese: { total: 0, confirmes: 0, aSurveiller: 0, nonRemplis: 0, erreurs: 0, long: 0, short: 0, neutre: 0, strategiesEvaluees: [] },
        indisponible: true,
        raison: `Données insuffisantes (${done.length} bougie(s)) : marché fermé ou hors séance.`
      });
    }

    const options = await optionsAnalyse(req.query);
    const multi = Multi.detecterTout(done, { symbol, timeframe: tf }, {
      profils: options.profils || []
    });

    res.json({
      ...multi,
      mode: options.mode,
      strategie: options.strategie || null,
      strategieAppliquee: options.strategie || null,
      strategies: options.strategies || []
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ─────────────────────────────────────────────────────────────
// ACTUALITÉS ET CALENDRIER — le contexte extérieur du marché
// ─────────────────────────────────────────────────────────────
/**
 * GET /api/news/panorama?marche=crypto|forex|macro&impact=1|2|3&force=1
 * Rend les dépêches ET le calendrier économique en un appel (ce que consomme
 * l'onglet News) : le trader voit dans la même vue ce qui se dit et ce qui
 * tombe dans les 24 h.
 *
 * Coût : zéro (RSS publics + calendrier ForexFactory). Cache 5 min sur les
 * dépêches, 30 min sur le calendrier.
 */
app.get('/api/news/panorama', requireAuth, async (req, res) => {
  try {
    const marche = req.query.marche ? String(req.query.marche) : undefined;
    const impactMin = Number(req.query.impact) || 0;
    const force = req.query.force === '1';
    const p = await News.panorama({ marche, impactMin, force });
    res.json({ success: true, ...p });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/news', requireAuth, async (req, res) => {
  try {
    const r = await News.chargerFlux(req.query.force === '1');
    let items = r.items || [];
    if (req.query.marche && req.query.marche !== 'tout') {
      const m = String(req.query.marche);
      items = items.filter(a => (a.marches || []).includes(m)
        || (a.actifs || []).includes(m.toUpperCase()));
    }
    res.json({ success: true, at: r.at, articles: items.slice(0, 80), sources: r.sources, degrade: !!r.degrade });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/calendrier', requireAuth, async (req, res) => {
  try {
    const r = await News.chargerCalendrier(req.query.force === '1');
    const impactMin = Number(req.query.impact) || 0;
    res.json({
      success: true,
      at: r.at,
      jours: News.parJour(r.evenements || [], { impactMin }),
      degrade: !!r.degrade,
      erreur: r.erreur || null
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


// ─────────────────────────────────────────────────────────────
// BACKTEST — le moteur rejoué sur l'historique
// ─────────────────────────────────────────────────────────────
/**
 * GET /api/backtest?symbol=BTCUSDT&tf=5m&pas=2&bougies=400&strategies=id1,id2
 *
 * Rejoue le moteur bougie par bougie sur un historique réel, avec le MÊME code
 * que le direct (aucune règle réécrite pour l'occasion), puis mesure : objectifs
 * atteints, stops, BE, expirations, R total et espérance par trade.
 *
 * Coût IA : zéro (calcul local). C'est ce qui permet de dire si le moteur gagne,
 * au lieu de le supposer.
 */
/** Courbe de capital à partir des R : chaque prise risque `riskPct` % du compte. */
function compteDepuisR(courbeR, initialCapital, riskPct) {
  let cap = initialCapital;
  const serie = [ +cap.toFixed(2) ];
  // ATTENTION : `courbeR` est CUMULÉE (chaque point = le total depuis le début).
  // La parcourir comme une suite de gains isolés composait le cumul à chaque
  // prise : 10 000 € devenaient 1 241 milliards. On ne compose que le DELTA.
  let precedent = 0;
  for (const cumul of courbeR) {
    const r = (Number.isFinite(cumul) ? cumul : 0) - precedent;
    precedent = Number.isFinite(cumul) ? cumul : precedent;
    cap = cap * (1 + (riskPct / 100) * r);
    if (!(cap > 0)) cap = 0;              // un compte ne descend pas sous zéro
    serie.push(+cap.toFixed(2));
  }
  return {
    initial: +initialCapital.toFixed(2),
    final: +cap.toFixed(2),
    gainPct: initialCapital > 0 ? +(((cap - initialCapital) / initialCapital) * 100).toFixed(2) : null,
    risqueParPrisePct: riskPct,
    serie
  };
}

/**
 * GET/POST /api/backtest
 *   GET  ?symbol=&tf=&pas=&bougies=&strategies=   → résultats en R
 *   POST {symbol, tf, riskPct, initialCapital}    → idem + courbe de capital
 * La page Outils appelait déjà ce POST avec un capital de départ ; il ne
 * répondait rien. Les deux formes partagent le même calcul.
 */
async function executerBacktest(src = {}) {
  const symbol = String(src.symbol || '').trim();
  const tf = String(src.tf || '5m').trim();
  const provider = String(src.provider || '').trim() || undefined;
  if (!symbol) { const e = new Error('Paramètre « symbol » requis'); e.code = 400; throw e; }
  if (!Market.TF_MS[tf]) { const e = new Error(`Timeframe inconnu : ${tf}`); e.code = 400; throw e; }

  // ⚠️ Le nom exporté est `MAX_BOUGIES` (avec un I). Lire `MAX_BOUGES` rendait
  // `undefined`, donc `Math.min(800, undefined)` = NaN, donc le courtier recevait
  // un nombre de bougies invalide et rendait son minimum — 93 bougies. TOUS les
  // backtests de l'écran tournaient sur 23 heures d'historique sans que rien ne
  // le signale. On valide le plafond au lieu de lui faire confiance.
  const plafond = Number.isFinite(Number(Backtest.MAX_BOUGIES)) && Number(Backtest.MAX_BOUGIES) >= 80
    ? Number(Backtest.MAX_BOUGIES) : 800;
  const demande = Math.round(Number(src.bougies) || 400);
  const bougies = Math.min(Math.max(demande, 80), plafond);
  const pas = Math.min(Math.max(Number(src.pas) || 2, 1), 10);
  const initialCapital = Number(src.initialCapital) || 0;
  const riskPct = Number(src.riskPct) || 0;

  const { candles } = await Market.getCandles(symbol, tf, bougies, provider);
  const options = await optionsAnalyse(src);
  const r = Backtest.lancer(candles, { symbol, timeframe: tf }, {
    profils: options.profils || [],
    pas,
    maxBougies: bougies,
    demandees: bougies
  });

  const resultat = {
    success: true,
    ...r,
    mode: options.mode,
    strategie: options.strategie || null,
    strategies: options.strategies || []
  };
  // Le compte n'a de sens que s'il y a des prises et un capital de départ.
  if (initialCapital > 0 && riskPct > 0 && Array.isArray(r.courbeR)) {
    resultat.compte = compteDepuisR(r.courbeR, initialCapital, riskPct);
  }
  return resultat;
}

app.get('/api/backtest', requireAuth, async (req, res) => {
  try { res.json(await executerBacktest(req.query)); }
  catch (e) { res.status(e.code || 500).json({ success: false, error: e.message }); }
});

app.post('/api/backtest', requireAuth, async (req, res) => {
  try { res.json(await executerBacktest({ ...req.body, ...req.query })); }
  catch (e) { res.status(e.code || 500).json({ success: false, error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
// RISQUE — taille de position, plafonds, état du compte
// ─────────────────────────────────────────────────────────────
/**
 * GET /api/risque
 * L'état du compte déduit du journal (capital composé, drawdown, perte du jour,
 * risque engagé par marché, levier) et les plafonds en vigueur.
 *
 * Ce n'est PAS un compte réel : aucune exécution n'a lieu. C'est la simulation
 * de ce que le journal aurait donné avec un risque fixe par trade.
 */
app.get('/api/risque', requireAuth, (req, res) => {
  try {
    const Risque = require('./risque.js');
    const Journal = require('./journal-signaux.js');
      const journal = Journal.charger();
      res.json({
        success: true,
        configuration: Risque.configuration(),
        etat: Risque.etat(journal.signaux || [], {
          capital: req.query.capital ? Number(req.query.capital) : null,
          risquePct: req.query.risquePct ? Number(req.query.risquePct) : null,
          depuis: journal.reinitialiseLe
        }),
        // La VRAIE performance : le journal rejoué avec les plafonds appliqués.
        // Distincte de `etat`, qui décrit le livre courant (positions ouvertes).
        simulation: Risque.simuler(journal.signaux || [], {
          capital: req.query.capital ? Number(req.query.capital) : null,
          risquePct: req.query.risquePct ? Number(req.query.risquePct) : null,
          depuis: journal.reinitialiseLe
        }),
      exemple: Risque.dimensionner(100, 98)
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/** POST /api/risque — règle les plafonds. Rendus relus depuis le disque. */
app.post('/api/risque', requireAuth, (req, res) => {
  try {
    const Risque = require('./risque.js');
    const cfg = Risque.configurer(req.body || {});
    res.json({ success: true, configuration: cfg });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
// MODÈLE (R attendu) — état et calibration
// ─────────────────────────────────────────────────────────────
/**
 * GET /api/modele
 * Ce que le modèle sait de lui-même : version, marchés, seuil, métriques
 * d'entraînement, et surtout sa CALIBRATION en direct — le R annoncé comparé au
 * R réellement obtenu, par quintile. Un modèle qui ne trie plus se voit ici
 * avant de coûter de l'argent.
 */
app.get('/api/modele', requireAuth, (req, res) => {
  try {
    const Modele = require('./modele.js');
    const Journal = require('./journal-signaux.js');
    const st = Journal.stats();
    res.json({
      success: true,
      modele: Modele.info(),
      seuilApplique: Modele.seuil(),
      seuilTop10: Modele.seuilTop10(),
      calibration: st.calibration,
      journal: { trades: st.clos, esperance: st.esperance, esperanceBrute: st.esperanceBrute }
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
// FRAIS DE TRANSACTION — spread et commission
// ─────────────────────────────────────────────────────────────
/**
 * GET /api/frais
 * Rend la configuration courante, les ordres de grandeur à vérifier, et
 * l'effet RÉEL sur le journal : brut contre net. Tant que rien n'est
 * configuré, les deux colonnes sont identiques — c'est voulu, et c'est ce qui
 * prouve qu'aucun verdict n'a été changé en douce.
 */
app.get('/api/frais', requireAuth, (req, res) => {
  try {
    const Frais = require('./frais.js');
    const Journal = require('./journal-signaux.js');
    const st = Journal.stats();
    res.json({
      success: true,
      configuration: Frais.configuration(),
      references: Frais.REFERENCES_A_VERIFIER,
      actifs: Frais.actifs(),
      journal: {
        trades: st.clos,
        esperance: st.esperance,
        esperanceBrute: st.esperanceBrute,
        rTotal: st.rTotal,
        rTotalBrut: st.rTotalBrut,
        fraisMoyenR: st.fraisMoyenR,
        coutCritique: st.coutCritique,
        coutCritiqueParMarche: st.coutCritiqueParMarche
      }
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/**
 * POST /api/frais
 * Enregistre les frais. `parSymbole` remplace les symboles fournis (les autres
 * sont conservés) : envoyer { parSymbole: { frxXAUUSD: { spread: 0.30 } } }
 * ne doit pas effacer la configuration des autres marchés.
 */
app.post('/api/frais', requireAuth, (req, res) => {
  try {
    const Frais = require('./frais.js');
    const body = req.body || {};
    const actuel = Frais.configuration();
    const parSymbole = { ...actuel.parSymbole };
    if (body.parSymbole && typeof body.parSymbole === 'object') {
      for (const [sym, val] of Object.entries(body.parSymbole)) {
        parSymbole[sym] = val;
      }
    }
    const cfg = Frais.configurer({
      defaut: 'defaut' in body ? body.defaut : actuel.defaut,
      commissionDefaut: 'commissionDefaut' in body ? body.commissionDefaut : actuel.commissionDefaut,
      parSymbole
    });
    res.json({ success: true, configuration: cfg, actifs: Frais.actifs() });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
// JOURNAL DES SIGNAUX — le devenir de chaque signal
// ─────────────────────────────────────────────────────────────
/**
 * GET /api/journal-signaux?symbol=&resultat=&source=&limite=
 * Rend les signaux enregistrés (du plus récent au plus ancien) et les stats.
 *
 * Un signal n'est pas « terminé » quand il s'affiche : il l'est quand le prix a
 * touché son objectif, son invalidation, ou qu'il est revenu au point d'entrée.
 * Ce journal est la mémoire du moteur — sans lui, impossible de dire quelle
 * stratégie fonctionne réellement.
 */
app.get('/api/journal-signaux', requireAuth, (req, res) => {
  try {
    const limite = Math.min(Number(req.query.limite) || 100, 500);
    const signaux = JournalSignaux.lister({
      symbol: req.query.symbol ? String(req.query.symbol) : undefined,
      resultat: req.query.resultat ? String(req.query.resultat) : undefined,
      source: req.query.source ? String(req.query.source) : undefined,
      limite
    });
    res.json({ success: true, signaux, stats: JournalSignaux.stats() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/journal-signaux/stats', requireAuth, (req, res) => {
  try { res.json({ success: true, stats: JournalSignaux.stats() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/** Force une mise à jour (le serveur le fait aussi tout seul, périodiquement). */
app.post('/api/journal-signaux/maj', requireAuth, async (req, res) => {
  try {
    const r = await JournalSignaux.mettreAJour(
      (symbol, tf, provider) => Market.getCandles(symbol, tf, 300, provider)
    );
    res.json({ success: true, ...r, stats: JournalSignaux.stats() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


app.get('/api/couts', requireAuth, async (req, res) => {
  try {
    res.json({ success: true, ...Couts.bilan() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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

  // Alertes : config chargée du disque, surveillance périodique démarrée.
  Alerts.load();
  // Push navigateur : clés VAPID du .env (sans elles, les abonnements restent inertes).
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    configurerVAPID(process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  }
  Alerts.start({
    market: Market,
    signals: Signals,
    // Multi-signaux : permet à la surveillance de dire QUELLE stratégie s'est
    // déclenchée, et de lister les motifs, au lieu d'un verdict anonyme.
    signaux: Multi,
    // Le journal des signaux : la surveillance l'alimente aussi, sinon il ne
    // contient que ce qui a été vu pendant que l'onglet « Direct » était ouvert.
    journal: JournalSignaux,
    // Les stratégies que l'utilisateur a choisi de surveiller. Sans ce câblage,
    // la surveillance tournait en mode « auto » (toutes les règles) et ignorait
    // complètement les stratégies configurées dans l'app.
    profilsSurveillance: async () => {
      try {
        const c = Alerts.get();
        const ids = Array.isArray(c.strategies) ? c.strategies.filter(Boolean) : [];
        if (!ids.length) return [];
        const strategies = await loadAllStrategies();
        return ids
          .map(id => (strategies || []).find(x => x.id === id))
          .filter(Boolean)
          .map(doc => Signals.profilDepuisStrategie(doc));
      } catch { return []; }
    },
    sendMail,
    sendPush,
    labelOf: id => {
      const s = Market.listSymbols().find(x => x.provider === id);
      return s ? s.providerLabel : id;
    }
  });

// ─────────────────────────────────────────────────────────────
// Journal des signaux : suivi périodique des issues. Toutes les deux minutes on
  // regarde si un signal enregistré a touché son objectif, son invalidation, ou
  // est revenu au point d'entrée. `unref()` : ce minuteur ne doit pas empêcher
  // l'arrêt propre du process.
  const JOURNAL_INTERVALLE_MS = Math.max(60, Number(process.env.JOURNAL_INTERVALLE_SEC || 120)) * 1000;
  const minuteurJournal = setInterval(() => {
    JournalSignaux.mettreAJour((symbol, tf, provider) => Market.getCandles(symbol, tf, 300, provider))
      .catch(() => { /* un marché en échec ne bloque pas les autres */ });
  }, JOURNAL_INTERVALLE_MS);
  if (typeof minuteurJournal.unref === 'function') minuteurJournal.unref();
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
