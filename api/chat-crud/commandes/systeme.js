/**
 * Chat CRUD — Commandes SYSTÈME.
 * Verbes : MONTRE (état), EXPLIQUE (diagnostic).
 */

const Memoire = require('../../memoire');
const Narrateur = require('../../apprentissage/narrateur');

async function etat(sujet, ctx) {
  const parties = [];

  // Santé process
  const uptime = Math.round(process.uptime());
  const memoireMo = Math.round(process.memoryUsage().rss / 1048576);
  parties.push(`Système opérationnel — uptime ${Math.floor(uptime / 3600)}h${Math.floor((uptime % 3600) / 60)}m, mémoire ${memoireMo} Mo.`);

  // Mémoire du système
  const texteMemoire = await Narrateur.expliquerEtat();
  parties.push(texteMemoire);

  // Santé DB (si disponible)
  try {
    const DB = require('../../core/db');
    const sql = DB.client();
    if (sql) {
      const r = await sql`select 1 as ok`;
      parties.push('Base : PostgreSQL connectée.');
    } else {
      parties.push('Base : repli JSON local (DATABASE_URL absent).');
    }
  } catch (e) {
    parties.push(`Base : injoignable (${e.message}).`);
  }

  return { texte: parties.join('\n\n') };
}

async function diagnostic(sujet, ctx) {
  const parties = ['Diagnostic système :'];

  // Variables critiques
  const env = process.env;
  parties.push(`NVIDIA_API_KEY : ${env.NVIDIA_API_KEY ? 'présente' : 'ABSENTE'}`);
  parties.push(`DATABASE_URL : ${env.DATABASE_URL ? 'présente' : 'absente (repli JSON)'}`);
  parties.push(`NODE_ENV : ${env.NODE_ENV || 'non défini'}`);
  parties.push(`SMTP_HOST : ${env.SMTP_HOST || 'absent'}`);
  parties.push(`CLOUDINARY_* : ${env.CLOUDINARY_CLOUD_NAME ? 'présent' : 'absent'}`);

  // Modules chargés
  try {
    const etat = await Memoire.etat();
    parties.push(`Mémoire : ${etat.faits} faits, ${etat.croyances} croyances, ${etat.exceptions} exceptions.`);
    parties.push(`Compétence : ${etat.competence.competent} ok, ${etat.competence.moyen} moyens, ${etat.competence.incompetent} à éviter.`);
  } catch (e) {
    parties.push(`Mémoire : indisponible (${e.message}).`);
  }

  return { texte: parties.join('\n') };
}

module.exports = { etat, diagnostic };
