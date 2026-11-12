/**
 * Session locale temporaire — pour rendre l'interface authentifiée et la vérifier
 * visuellement, sans connaître le mot de passe ni l'OTP du propriétaire.
 *
 * Ce script n'ouvre AUCUNE porte en production : il écrit une session dans le
 * magasin local, imprime le jeton, et sait la révoquer. Rien n'est ajouté au
 * code du serveur.
 *
 *   node tools/session-temporaire.js creer     → imprime le jeton
 *   node tools/session-temporaire.js revoquer  → supprime les sessions de test
 *
 * Les sessions créées ici portent `test: true` : la révocation ne touche donc
 * que celles-là, jamais celle de l'utilisateur.
 */
const chemin = require('path');
// dotenv vit dans api/node_modules : résolution par chemin, pas par module.
require(chemin.join(__dirname, '..', 'api', 'node_modules', 'dotenv'))
  .config({ path: chemin.join(__dirname, '..', '.env') });
const path = chemin;
const crypto = require('crypto');
const DB = require(path.join(__dirname, '..', 'api', 'core', 'db'));

const action = process.argv[2] || 'creer';

(async () => {
  await DB.init();
  const sessions = await DB.loadSessions();

  if (action === 'revoquer') {
    let n = 0;
    for (const [t, s] of Object.entries(sessions)) {
      if (s && s.test) { delete sessions[t]; n++; }
    }
    await DB.saveSessions(sessions);
    console.log('sessions de test révoquées :', n);
    process.exit(0);
  }

  const compte = await DB.getAccount();
  if (!compte) { console.error('Aucun compte local : rien à rendre.'); process.exit(1); }

  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = {
    username: compte.username || compte.email || 'proprietaire',
    expires: Date.now() + 60 * 60 * 1000,   // 1 h, le temps de vérifier
    test: true
  };
  await DB.saveSessions(sessions);
  console.log('utilisateur :', sessions[token].username);
  console.log('jeton       :', token);
  process.exit(0);
})().catch(e => { console.error('ERREUR', e.message); process.exit(1); });
