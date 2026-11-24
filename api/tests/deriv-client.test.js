const assert = require('assert');
const DerivClient = require('../deriv/client');
const DB = require('../core/db');

async function runTests() {
  console.log('[Test Deriv] Démarrage des vérifications...');
  await DB.init();

  // 1. Rejet d'un token manquant ou vide
  const testVide = await DerivClient.verifierEtAutoriser('1089', '');
  assert.strictEqual(testVide.ok, false);
  assert.match(testVide.error, /manquant/i);
  console.log('  ✓ Token vide rejeté immédiatement');

  // 2. Rejet propre d'un token invalide par les serveurs officiels Deriv
  const testFaux = await DerivClient.verifierEtAutoriser('1089', 'FAUX_TOKEN_XYZ_123');
  assert.strictEqual(testFaux.ok, false);
  assert.match(testFaux.error, /invalid|token/i);
  console.log('  ✓ Rejet officiel reçu de Deriv :', testFaux.error);

  // 3. Statut initial (non connecté)
  await DerivClient.deconnecter();
  const statutInitial = await DerivClient.obtenirStatut();
  assert.strictEqual(statutInitial.connecte, false);
  console.log('  ✓ Statut initial propre (non connecté)');

  // 4. Masquage de sécurité du token
  await DB.kvEcrire('deriv_config', {
    appId: '1089',
    apiToken: 'secretTokenDeTest123456789',
    account: { loginid: 'CR123456', balance: 1500, currency: 'USD', isVirtual: false, typeCompte: 'Réel' },
    actif: true
  });
  const statutConnecte = await DerivClient.obtenirStatut();
  assert.strictEqual(statutConnecte.connecte, true);
  assert.strictEqual(statutConnecte.tokenMasque.includes('••••••••'), true);
  assert.strictEqual(statutConnecte.tokenMasque.includes('secretTokenDeTest'), false);
  console.log('  ✓ Token masqué de façon sécurisée :', statutConnecte.tokenMasque);

  // 5. Nettoyage après test
  await DerivClient.deconnecter();
  const statutFinal = await DerivClient.obtenirStatut();
  assert.strictEqual(statutFinal.connecte, false);
  console.log('  ✓ Déconnexion propre validée');

  console.log('Tous les tests Deriv ont réussi !');
}

runTests().catch(e => {
  console.error('Échec du test Deriv :', e);
  process.exit(1);
});
