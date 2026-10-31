#!/usr/bin/env node
/**
 * 5trade — contrôle avant déploiement.
 *
 * Vérifie que l'environnement réuni suffira à la plateforme visée, AVANT de
 * lancer un build de 5 minutes : une variable manquante ne se voit qu'au premier
 * écran qui la touche (inscription, analyse, upload), jamais au démarrage.
 *
 *   node tools/preflight-deploy.js render
 *   node tools/preflight-deploy.js koyeb
 *   node tools/preflight-deploy.js hostless
 *   node tools/preflight-deploy.js --url https://fivetrade-xxx.code.run
 *
 * Sans argument : inventaire + conseils génériques.
 * Lit .env s'il existe, sinon les variables d'environnement déjà posées.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cible = (process.argv[2] || '').replace(/^--target=/, '');
const urlIdx = process.argv.indexOf('--url');
const url = urlIdx > 0 ? process.argv[urlIdx + 1] : '';

function lireEnv() {
  const env = { ...process.env };
  const f = path.join(ROOT, '.env');
  if (fs.existsSync(f)) {
    for (const ligne of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (env[m[1]] === undefined || env[m[1]] === '') env[m[1]] = v;
    }
  }
  return env;
}

const env = lireEnv();
const bloque = [];
const avertit = [];
const ok = [];
const val = k => (env[k] || '').trim();
const present = k => val(k).length > 0;

// ─── 1. Base de données ───
if (!present('DATABASE_URL')) {
  bloque.push('DATABASE_URL absente : en production l\'app refuse de démarrer (garde-fou de l\'entrypoint).');
} else if (/(^|@)(localhost|127\.0\.0\.1)/.test(val('DATABASE_URL'))) {
  bloque.push('DATABASE_URL pointe vers localhost : injoignable depuis la plateforme. Prends la chaîne du fournisseur (Render/Hostless/Neon) avec ?sslmode=require.');
} else {
  ok.push(`DATABASE_URL distante : ${val('DATABASE_URL').replace(/:\/\/[^@]*@/, '://***@').slice(0, 48)}…`);
}

// ─── 2. IA : au moins une voie, idéalement les deux ───
if (!present('DEEPSEEK_API_KEY') && !present('NVIDIA_API_KEY')) {
  bloque.push('Aucune clé IA : ni DEEPSEEK_API_KEY (payant) ni NVIDIA_API_KEY (secours gratuit). Les analyses échoueront.');
} else if (!present('NVIDIA_API_KEY')) {
  avertit.push('Pas de NVIDIA_API_KEY : plus aucun secours gratuit si le solde DeepSeek tombe à zéro.');
} else {
  ok.push(`Secours gratuit armé : ${(val('NVIDIA_MODELS') || 'défaut').split(',').length} modèle(s) NVIDIA NIM`);
}

// ─── 3. Comptes : OTP par e-mail ───
if (val('OTP_ON_LOGIN') !== 'false') {
  const manquants = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'].filter(k => !present(k));
  if (manquants.length) {
    avertit.push(`SMTP incomplet (${manquants.join(', ')}) : l'inscription ne pourra pas envoyer de code. Note : beaucoup de PaaS bloquent le port SMTP sortant — prévoir une API HTTP.`);
  } else {
    ok.push('SMTP renseigné (vérifier que le port 587 sort bien depuis la plateforme)');
  }
}

// ─── 4. Vision ───
if (val('VISION_PROVIDER') === 'deepseek') {
  avertit.push('VISION_PROVIDER=deepseek : les captures ne seront pas lues (le modèle texte ne voit pas les images).');
} else if (!present('GEMINI_API_KEY')) {
  avertit.push('Pas de GEMINI_API_KEY : l\'analyse des captures est indisponible, le reste fonctionne.');
} else {
  ok.push(`Vision : gemini / ${val('GEMINI_VISION_MODEL') || 'défaut'}`);
}

// ─── 5. Stockage fichiers ───
if (present('CLOUDINARY_CLOUD_NAME')) ok.push('Cloudinary configuré pour les fichiers envoyés');
else avertit.push('Pas de Cloudinary : les fichiers restent sur le volume de la plateforme (perdus si le disque est éphémère).');

// ─── 6. Spécificités par plateforme ───
const conseils = {
  render: [
    'render.yaml à la racine ; New > Blueprint > ce dépôt.',
    'Base gratuite = expire au bout de 30 jours ; le service gratuit s\'endort après ~15 min.',
    'Plan gratuit = PAS de disque persistant : /app/state repart vide à chaque déploiement (les graines y sont recopiées).',
    'Health check attendu : /healthz.',
  ],
  koyeb: [
    'Dockerfile détecté depuis le dépôt GitHub, ou `docker build` + image poussée.',
    'Koyeb attend l\'écoute sur le port qu\'il injecte (PORT) — l\'image utilise process.env.PORT.',
    'Volume persistant : monter sur /app/state (ou pointer DATA_DIR/KNOWLEDGE_BASE_DIR/UPLOADS_DIR).',
    'Health check : HTTP GET /healthz.',
  ],
  hostless: [
    'New app > GitHub > Dockerfile détecté automatiquement (Pas de carte requise, l\'app ne dort pas).',
    'Free allowance mutualisée : 0,5 vCPU / 1 Gio / 512 Mio de base, sans carte.',
    'Base PostgreSQL managée disponible dans le projet : copier sa chaîne dans DATABASE_URL.',
    'Health check : /healthz ; volume sur /app/state si proposé, sinon disque éphémère assumé.',
  ],
  northflank: [
    'ATTENTION : un moyen de paiement par défaut est exigé avant toute création de service, même sur le plan gratuit.',
    'Nom de service commençant par une lettre (5trade refusé → fivetrade), région obligatoire.',
    'tools/northflank-deploy.js fait tout une fois la carte enregistrée.',
  ],
  fly: [
    'fly launch --dockerfile Dockerfile ; fly secrets set … ; fly volumes create etat --size 1.',
    'Monter le volume sur /app/state (ou pointer DATA_DIR).',
  ],
  vps: [
    'docker build -t fivetrade . && docker run -d -p 3001:3001 --env-file .env -v fivetrade-state:/app/state fivetrade',
    'Derrière nginx/Caddy : proxy_pass http://127.0.0.1:3001, health /healthz.',
  ],
};

console.log('5trade — contrôle avant déploiement' + (cible ? ` (cible : ${cible})` : ''));
console.log('─'.repeat(60));
for (const l of ok) console.log('  OK    ' + l);
for (const l of avertit) console.log('  NOTE  ' + l);
for (const l of bloque) console.log('  BLOQUE ' + l);

if (cible && conseils[cible]) {
  console.log(`\nÉtapes ${cible} :`);
  conseils[cible].forEach((l, i) => console.log(`  ${i + 1}. ${l}`));
} else if (cible) {
  console.log(`\nCible inconnue : ${cible} (connues : ${Object.keys(conseils).join(', ')}).`);
}

(async () => {
  if (url) {
    console.log(`\nContrôle de l'instance : ${url}/healthz`);
    try {
      const r = await fetch(url.replace(/\/$/, '') + '/healthz', { signal: AbortSignal.timeout(20000) });
      const d = await r.json().catch(() => ({}));
      console.log(`  HTTP ${r.status} ${JSON.stringify(d)}`);
      if (r.ok && d.ok) console.log(`  OK    instance en ligne, stockage=${d.stockage}`);
      else { console.log('  BLOQUE instance en mauvaise santé'); bloque.push('healthz'); }
    } catch (e) {
      console.log(`  BLOQUE injoignable : ${e.message}`);
      bloque.push('healthz');
    }
  }
  console.log(`\nRésultat : ${bloque.length ? `${bloque.length} blocage(s)` : 'prêt à déployer'}`);
  process.exit(bloque.length ? 1 : 0);
})();
