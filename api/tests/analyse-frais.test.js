const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.FRAIS_FICHIER = path.join(fs.mkdtempSync(path.join(os.tmpdir(), '5trade-frais-')), 'frais.json');
const frais = require('../core/frais');
const historique = require('../sources/historique');
const backtest = require('../engine/backtest');
const analyse = require('../engine/analyse');
test('analyse conserve les frais et transmet ses hypothèses, même en cas d’échec', async () => {
  const initial = frais.configurer({ defaut: 2, commissionDefaut: 0.01, parSymbole: { AUTRE: { spread: 3 } } });
  const charger = historique.charger, lancer = backtest.lancer;
  historique.charger = () => Array.from({ length: 300 }, (_, i) => ({ t: i, c: 100, h: 101, l: 99 }));
  let options;
  backtest.lancer = (_serie, _meta, opts) => { options = opts; return { trades: [] }; };
  try {
    await analyse.analyser({ symbol: 'BTC-USD' });
    assert.deepEqual(frais.configuration(), initial);
    assert.equal(options.frais.parSymbole['BTC-USD'].spread, 12);
    backtest.lancer = () => { throw new Error('erreur simulée'); };
    await assert.rejects(analyse.analyser({ symbol: 'BTC-USD' }), /erreur simulée/);
    assert.deepEqual(frais.configuration(), initial);
  } finally { historique.charger = charger; backtest.lancer = lancer; }
});
