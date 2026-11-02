/**
 * 5trade — sauvegarde de la base vers Cloudflare R2.
 *
 * Enjeu réel : l'offre gratuite donne 512 Mo de base et AUCUNE sauvegarde. Une
 * mauvaise migration, un reset de compte ou une suppression malheureuse sont
 * irréversibles. Ce module exporte toutes les tables, compresse et dépose le
 * fichier dans R2 (les clés S3_* sont déjà là pour les uploads).
 *
 * Le planning tourne dans l'application (setInterval) plutôt que dans un cron de
 * la plateforme : il hérite ainsi des variables d'environnement, et fonctionne
 * sur n'importe quel hébergeur.
 *
 *   BACKUP_ACTIF=false          coupe-circuit
 *   BACKUP_INTERVALLE_H=24      fréquence
 *   BACKUP_PREFIXE=5trade/backups
 */
const zlib = require('zlib');
const DB = require('./db');
const S3 = require('./s3');

const PREFIXE = (process.env.BACKUP_PREFIXE || '5trade/backups').replace(/\/+$/, '');
const INTERVALLE_H = Number(process.env.BACKUP_INTERVALLE_H || 24);
const ACTIF = String(process.env.BACKUP_ACTIF || 'true') !== 'false';

let minuteur = null;
let dernier = null;   // { at, cle, octets, tables, erreur }

const nomFichier = (d = new Date()) =>
  `${PREFIXE}/db-${d.toISOString().replace(/[:.]/g, '-').slice(0, 16)}.json.gz`;

/** Exporte + compresse. Séparé de l'envoi : testable sans réseau. */
async function construire() {
  const sauvegarde = await DB.exporterTout();
  const brut = Buffer.from(JSON.stringify(sauvegarde));
  const compresse = zlib.gzipSync(brut, { level: 9 });
  return {
    sauvegarde,
    corps: compresse,
    tables: {
      kv: (sauvegarde.kv || []).length,
      strategies: (sauvegarde.strategies || []).length,
      trades: (sauvegarde.trades || []).length,
      fichiers: sauvegarde.mode === 'fichiers' ? Object.keys(sauvegarde.fichiers || {}).length : 0
    },
    octetsBruts: brut.length,
    octets: compresse.length
  };
}

/** Sauvegarde complète : export, compression, dépôt R2. */
async function sauvegarder() {
  const t0 = Date.now();
  const { corps, tables, octetsBruts, octets, sauvegarde } = await construire();
  const cle = nomFichier();

  if (!S3.s3Ready()) {
    dernier = { at: new Date().toISOString(), cle: null, tables, erreur: 'R2 non configuré (S3_*)' };
    return { ...dernier, dureeMs: Date.now() - t0 };
  }

  let url;
  try {
    // Attention à l'ordre : uploadToS3(buffer, key, contentType).
    url = await S3.uploadToS3(corps, cle, 'application/gzip');
  } catch (e) {
    dernier = { at: new Date().toISOString(), cle: null, tables, erreur: e.message.slice(0, 200) };
    return { ...dernier, dureeMs: Date.now() - t0 };
  }

  dernier = {
    at: new Date().toISOString(), cle, url, tables,
    version: sauvegarde.version, mode: sauvegarde.mode,
    octets, octetsBruts, dureeMs: Date.now() - t0
  };
  console.log(`[sauvegarde] ${cle} — ${tables.kv} kv, ${tables.strategies} stratégies, ` +
    `${tables.trades} trades (${Math.round(octets / 1024)} Ko gz) en ${dernier.dureeMs} ms`);
  return dernier;
}

const etat = () => ({
  actif: ACTIF,
  intervalleH: INTERVALLE_H,
  r2: S3.s3Ready(),
  prefixe: PREFIXE,
  dernier
});

function start() {
  if (!ACTIF) { console.log('   Sauvegarde  : désactivée (BACKUP_ACTIF=false)'); return; }
  // Une première sauvegarde 90 s après le démarrage : elle garantit qu'une
  // instance fraîchement déployée laisse au moins une copie.
  setTimeout(() => { sauvegarder().catch(e => console.error('[sauvegarde]', e.message)); }, 90 * 1000);
  minuteur = setInterval(() => {
    sauvegarder().catch(e => console.error('[sauvegarde]', e.message));
  }, INTERVALLE_H * 3600 * 1000);
  if (typeof minuteur.unref === 'function') minuteur.unref();
  console.log(`   Sauvegarde  : toutes les ${INTERVALLE_H} h vers ${PREFIXE}/ (R2 ${S3.s3Ready() ? 'prêt' : 'NON configuré'})`);
}

function stop() {
  if (minuteur) clearInterval(minuteur);
  minuteur = null;
}

module.exports = { construire, sauvegarder, etat, start, stop, nomFichier };
