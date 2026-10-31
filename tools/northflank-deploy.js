#!/usr/bin/env node
/**
 * 5trade — déploiement Northflank, piloté par l'API (aucune action manuelle).
 *
 * Idempotent : relançable sans rien casser. Il
 *   1. crée (ou retrouve) le projet `5trade`,
 *   2. crée (ou retrouve) l'addon PostgreSQL, lit sa chaîne de connexion,
 *   3. crée (ou retrouve) le service combiné qui construit /Dockerfile du dépôt git,
 *      avec un volume persistant monté sur /app/state et le port HTTP 3001,
 *   4. pousse les variables d'environnement lues dans .env (+ DATABASE_URL de l'addon),
 *   5. lance le build et suit son avancement.
 *
 * Usage :
 *   NF_TOKEN=... node tools/northflank-deploy.js
 * Variables optionnelles : NF_PROJECT, NF_PLAN (défaut nf-compute-50),
 * NF_BUILD_PLAN, NF_BRANCH, NF_REPO, NF_STORAGE_MB, NF_DRY=1 (aucune écriture).
 */
const fs = require('fs');
const path = require('path');

const API = 'https://api.northflank.com/v1';
const TOKEN = process.env.NF_TOKEN;
// Northflank impose un nom commençant par une LETTRE : « 5trade » est refusé
// (^[a-zA-Z]...). D'où « fivetrade », qui donne aussi un domaine lisible.
// Le plan gratuit plafonne aussi le nombre de PROJETS : on réutilise donc le
// projet existant (« Default ») et le nom sert au SERVICE.
const PROJET = process.env.NF_PROJECT || 'default';
const SERVICE = process.env.NF_SERVICE || 'fivetrade';
const REGION = process.env.NF_REGION || 'europe-west';
const PLAN = process.env.NF_PLAN || 'nf-compute-50';           // 0,5 vCPU / 1 Go — 12 $/mois
const PLAN_BUILD = process.env.NF_BUILD_PLAN || 'nf-compute-400-16';
const PLAN_ADDON = process.env.NF_PLAN_ADDON || 'nf-compute-10';
const BRANCHE = process.env.NF_BRANCH || 'main';
const REPO = process.env.NF_REPO || 'https://github.com/nocodescreen-tech/5trade';
const STOCKAGE_MO = Number(process.env.NF_STORAGE_MB || 2048);
const STOCKAGE_ADDON_MO = Number(process.env.NF_ADDON_STORAGE_MB || 5120);
const SEC = process.env.NF_DRY === '1';
const ROOT = path.join(__dirname, '..');

if (!TOKEN) {
  console.error('NF_TOKEN manquant. Northflank > Account settings > API > Create API token.');
  process.exit(1);
}

const journal = (...a) => console.log(...a);
const pause = ms => new Promise(r => setTimeout(r, ms));

async function api(methode, chemin, corps) {
  const r = await fetch(API + chemin, {
    method: methode,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: corps ? JSON.stringify(corps) : undefined,
    signal: AbortSignal.timeout(45000)
  });
  const texte = await r.text();
  let data = {};
  try { data = texte ? JSON.parse(texte) : {}; } catch { data = { brut: texte.slice(0, 400) }; }
  if (!r.ok) {
    const e = new Error(`${methode} ${chemin} → HTTP ${r.status} ${JSON.stringify(data).slice(0, 600)}`);
    e.status = r.status;
    throw e;
  }
  return data.data !== undefined ? data.data : data;
}

// ─── .env local → variables à pousser (DATABASE_URL vient de l'addon) ───
function lireEnv() {
  const f = path.join(ROOT, '.env');
  const out = {};
  if (!fs.existsSync(f)) return out;
  for (const ligne of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  delete out.DATABASE_URL;      // fourni par l'addon
  delete out.PORT;              // imposé par l'image (3001)
  delete out.HOST;
  out.NODE_ENV = 'production';
  out.TZ = 'UTC';
  return out;
}

async function main() {
  journal(`Projet ${PROJET} / service ${SERVICE} / plan ${PLAN} / branche ${BRANCHE}${SEC ? '   [DRY]' : ''}`);

  // 1. Projet
  const projets = await api('GET', '/projects');
  let projet = (projets.projects || []).find(p => p.name === PROJET || p.id === PROJET);
  if (!projet) {
    if (SEC) throw new Error(`DRY: le projet ${PROJET} n'existe pas`);
    journal(`→ création du projet ${PROJET} (${REGION})`);
    projet = await api('POST', '/projects', {
      name: PROJET,
      description: 'Plateforme de trading IA 5trade',
      region: REGION
    });
  } else {
    journal(`→ projet existant : ${projet.id}`);
  }
  const pid = projet.id || projet.name;

  // 2. Addon PostgreSQL — ignoré si une base externe est fournie (NF_DB_URL),
  // ce qui permet d'utiliser un Postgres gratuit ailleurs (Neon, Supabase…).
  let databaseUrl = process.env.NF_DB_URL || '';
  if (databaseUrl) {
    journal('→ base externe fournie (NF_DB_URL), pas d\'addon Northflank');
  } else {
  const addons = await api('GET', `/projects/${pid}/addons`);
  let addon = (addons.addons || []).find(a => a.name === 'postgres');
  if (!addon) {
    if (SEC) throw new Error('DRY: addon postgres absent');
    journal('→ création de l\'addon PostgreSQL');
    addon = await api('POST', `/projects/${pid}/addons`, {
      name: 'postgres',
      type: 'postgresql',
      version: 'latest',
      billing: { deploymentPlan: PLAN_ADDON, storage: STOCKAGE_ADDON_MO, replicas: 1 }
    });
  }
  journal(`→ addon postgres : ${addon.id || addon.name} (${addon.status || 'création'})`);

  // Attendre que l'addon réponde avant de lire ses identifiants.
  let identifiants = null;
  for (let i = 0; i < 40 && !identifiants; i++) {
    try {
      const c = await api('GET', `/projects/${pid}/addons/${addon.id}/credentials`);
      identifiants = c.credentials || c;
      if (!Object.keys(identifiants || {}).length) { identifiants = null; throw new Error('vide'); }
    } catch {
      await pause(15000);
    }
  }
  if (!identifiants) throw new Error('addon PostgreSQL : identifiants indisponibles après 10 min');
  databaseUrl = identifiants.connectionString || identifiants.connectionStringUri
    || identifiants.POSTGRES_URI || identifiants.uri || identifiants.url;
  if (!databaseUrl) {
    console.error('Clés d\'identifiants reçues :', Object.keys(identifiants));
    throw new Error('chaîne de connexion PostgreSQL introuvable dans les identifiants');
  }
  }
  journal(`→ DATABASE_URL obtenue (${databaseUrl.replace(/:[^:@]+@/, ':***@').slice(0, 60)}…)`);

  // 3. Service combiné (build + run)
  const services = await api('GET', `/projects/${pid}/services`);
  let service = (services.services || []).find(s => s.name === SERVICE);
  if (!service) {
    if (SEC) throw new Error('DRY: service absent');
    journal(`→ création du service ${SERVICE}`);
    service = await api('POST', `/projects/${pid}/services/combined`, {
      name: SERVICE,
      description: '5trade - API et frontend dans le meme processus',
      billing: { deploymentPlan: PLAN, buildPlan: PLAN_BUILD },
      buildSource: 'git',
      vcsData: { projectUrl: REPO, projectType: 'github', projectBranch: BRANCHE },
      buildSettings: {
        dockerfile: { dockerFilePath: '/Dockerfile', dockerWorkDir: '/' }
      },
      deployment: {
        instances: 1,
        docker: { configType: 'default' },
        volumes: [{
          id: 'state',
          mounts: [{ containerMountPath: '/app/state' }],
          spec: { accessMode: 'ReadWriteOnce', storageSize: STOCKAGE_MO }
        }]
      },
      ports: [{ name: 'http', internalPort: 3001, public: true, protocol: 'HTTP' }]
    });
  } else {
    journal(`→ service existant : ${service.id}`);
  }
  const sid = service.id || service.name;

  // 4. Variables d'environnement
  const env = { ...lireEnv(), DATABASE_URL: databaseUrl };
  journal(`→ ${Object.keys(env).length} variables : ${Object.keys(env).join(', ')}`);
  if (!SEC) {
    try {
      await api('PATCH', `/projects/${pid}/services/combined/${sid}`, { runtimeEnvironment: env });
    } catch (e) {
      journal('  PATCH refusé, repli sur runtime-environment :', e.message.slice(0, 120));
      await api('POST', `/projects/${pid}/services/${sid}/runtime-environment`, { runtimeEnvironment: env });
    }
  }

  // 5. Health check HTTP réel (touche la base)
  if (!SEC) {
    const checks = [{
      protocol: 'HTTP', type: 'readinessProbe', path: '/healthz', port: 3001,
      initialDelaySeconds: 20, periodSeconds: 15, timeoutSeconds: 5,
      failureThreshold: 4, successThreshold: 1
    }];
    try {
      await api('PATCH', `/projects/${pid}/services/combined/${sid}`, { healthChecks: checks });
    } catch {
      await api('POST', `/projects/${pid}/services/${sid}/health-checks`, { healthChecks: checks });
    }
  }

  // 6. Build
  if (!SEC) {
    journal('→ déclenchement du build');
    try {
      await api('POST', `/projects/${pid}/services/${sid}/build`, { buildSource: 'git' });
    } catch (e) {
      journal('  (build déjà en cours ou déclenché par le déploiement :', e.message.slice(0, 140), ')');
    }
  }

  journal('\nTerminé. Suivre le build :');
  journal(`  curl -H "Authorization: Bearer $NF_TOKEN" ${API}/projects/${pid}/services/${sid}/build-logs`);
  journal(`  curl -H "Authorization: Bearer $NF_TOKEN" ${API}/projects/${pid}/services/${sid}/deployment`);
  journal(`Santé publique une fois déployé : voir ports du service (domaine *.code.run)/healthz`);
}

main().catch(e => { console.error('ÉCHEC :', e.message); process.exit(1); });
