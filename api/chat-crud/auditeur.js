/**
 * 5trade — Chat CRUD : auditeur.
 *
 * Trace chaque action du chat dans le journal d'audit existant
 * (api/security/audit.js), avec l'acteur, l'action, la cible, et le résultat.
 *
 * Si l'audit est indisponible, l'action échoue OU réussit silencieusement
 * selon le niveau (lecture = OK silencieux, modification = doit être tracé).
 */

const Audit = require('../security/audit');

async function tracer({ acteur, action, cible, detail, succes = true, niveau }) {
  // Les actions de lecture n'exigent pas un audit parfait
  if (niveau === 'lecture') {
    try {
      await Audit.enregistrer({ acteur, action, cible, detail, succes });
    } catch { /* audit indisponible : OK pour lecture */ }
    return { ok: true };
  }

  // Les actions de modification DOIVENT être tracées
  try {
    const r = await Audit.enregistrer({ acteur, action, cible, detail, succes });
    if (!r.ok) {
      console.warn('[chat-crud] audit impossible :', r.raison);
      // On continue quand même — l'action est déjà faite
    }
    return r;
  } catch (e) {
    console.error('[chat-crud] audit erreur :', e.message);
    return { ok: false, raison: e.message };
  }
}

module.exports = { tracer };
