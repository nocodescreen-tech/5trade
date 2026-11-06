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
const DB = require('../core/db');
const S3 = require('../core/s3');

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


// ── Purge des sauvegardes ──
// Sans purge, chaque sauvegarde s'accumule indéfiniment dans le stockage : au bout
// d'un an à raison d'une toutes les 6 h, c'est 1 460 objets. On garde les dernières
// et on supprime le reste — une sauvegarde de l'an dernier ne sert plus à rien.
const GARDER = Number(process.env.BACKUP_GARDER) > 0 ? Number(process.env.BACKUP_GARDER) : 14;
const CLE_MANIFESTE = 'sauvegardes';

/**
 * Enregistre la nouvelle clé, puis supprime les plus anciennes au-delà de GARDER.
 * @returns {{gardees:number, supprimees:string[], erreurs:string[]}}
 */
async function purger(cle) {
  const erreurs = [];
  let manifeste = [];
  try {
    const brut = await DB.kvLire(CLE_MANIFESTE, []);
    manifeste = Array.isArray(brut) ? brut.filter(Boolean) : [];
  } catch (e) { erreurs.push('manifeste illisible : ' + e.message.slice(0, 80)); }

  if (cle) manifeste.push(cle);
  const uniques = [...new Set(manifeste)];
  const gardees = uniques.slice(-GARDER);
  const aSupprimer = uniques.slice(0, Math.max(0, uniques.length - GARDER));

  const supprimees = [];
  for (const vieille of aSupprimer) {
    try {
      const d = S3.s3Sign('DELETE', vieille, null);
      const r = await fetch(d.url, { method: 'DELETE', headers: d.headers });
      // 404 = déjà absente : ce n'est pas une erreur, c'est le résultat voulu.
      if (r.ok || r.status === 404) supprimees.push(vieille);
      else erreurs.push(vieille + ' → HTTP ' + r.status);
    } catch (e) {
      erreurs.push(vieille + ' → ' + e.message.slice(0, 60));
    }
  }

  try { await DB.kvEcrire(CLE_MANIFESTE, gardees); }
  catch (e) { erreurs.push('manifeste non enregistré : ' + e.message.slice(0, 80)); }

  if (supprimees.length) console.log('[sauvegarde] purge : ' + supprimees.length + ' ancienne(s) copie(s) supprimée(s)');
  return { gardees: gardees.length, supprimees, erreurs };
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
  // Purge APRÈS le dépôt : si elle échoue, la sauvegarde du jour reste valide.
  try {
    const purge = await purger(cle);
    dernier.purge = purge;
  } catch (e) {
    dernier.purge = { erreurs: [e.message.slice(0, 120)] };
  }
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

module.exports = { construire, sauvegarder, purger, etat, start, stop, nomFichier, GARDER };
