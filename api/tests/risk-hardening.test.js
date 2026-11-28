const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), '5trade-risk-'));
process.env.RISQUE_FICHIER = path.join(dir, 'risk.json');
const Risk = require('../risk/risque');
const Decision = require('../engine/DecisionEngine');
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
test('invalid capital, stop or risk cannot produce a position', () => {
  for (const args of [[100, 98, 0, 1], [100, 98, -10, 1], [100, null, 1000, 1], [100, 98, 1000, -1]]) {
    assert.equal(Risk.dimensionner(...args).taille, null);
  }
});
test('missing account cannot authorize execution', () => {
  assert.equal(Risk.verifierPrise({ entree: 100, stop: 98, symbol: 'XAUUSD' }, null).ok, false);
});
test('selected strategies never fall back to generic patterns', () => {
  const generic = { id: 'g', nom: 'generic', source: 'motif', sens: 'long', force: 0.9, executable: true, confirme: true, valide: true };
  assert.equal(Decision.niveauArbitrage([generic], {}, { profils: [{}] }).decision, 'NO_TRADE');
  assert.equal(Decision.niveauArbitrage([generic], {}, {}).decision, 'ACHAT');
});
test('missing TP2 blocks execution', () => {
  const signal = { source: 'strategie', sens: 'long', status: 'confirme', confirme: true, entree: 100, stop: 98, objectifs: [104] };
  const result = Decision.niveauExecution([signal], { symbol: 'XAUUSD' }, { verifierFrais: false, verifierModele: false });
  assert.equal(result.details[0].ok, false);
  assert.ok(result.details[0].blocages.some(x => x.includes('objectif 2')));
});
