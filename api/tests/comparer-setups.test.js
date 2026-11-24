const test = require('node:test');
const assert = require('node:assert/strict');

const Comparer = require('../data-engine/comparer-setups');

const candles = Array.from({ length: 120 }, (_, i) => ({
  t: i * 86400000, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, closed: true
}));

const fibo = {
  id: 'fibo', title: 'Fibonacci pullback', marches: ['forex'], supportedRegimes: ['trending'],
  moteur: { regles: ['R4'], seuilRegles: 1, seuilForce: 0.5, timeframes: ['1d'] }
};
const breakout = {
  id: 'breakout', title: 'Structure breakout', marches: ['indices'], supportedRegimes: ['trending'],
  moteur: { regles: ['R2'], seuilRegles: 1, seuilForce: 0.5, timeframes: ['1d'] }
};

test('compare chaque setup uniquement sur ses marches et regimes declares', () => {
  const appels = [];
  const backtester = (serie, meta, options) => {
    appels.push({ n: serie.length, symbol: meta.symbol, setup: options.profils[0].id });
    return { trades: [{ resultat: 'tp1', r: 1 }, { resultat: 'sl', r: -0.5 }] };
  };
  const rapport = Comparer.comparer({
    setups: [fibo, breakout],
    marches: [
      { symbol: 'EURUSD', timeframe: '1d', regime: 'trending', candles },
      { symbol: 'NQ=F', timeframe: '1d', regime: 'ranging', candles }
    ],
    backtester
  });

  assert.equal(appels.length, 2); // IS + OOS du seul couple compatible
  assert.deepEqual(appels.map(a => a.setup), ['fibo', 'fibo']);
  assert.equal(rapport.lignes.filter(l => l.statut === 'evalue').length, 1);
  assert.equal(rapport.lignes.filter(l => l.statut === 'refuse').length, 3);
  const ligne = rapport.lignes.find(l => l.statut === 'evalue');
  assert.equal(ligne.setup, 'fibo');
  assert.equal(ligne.is.esperance, 0.25);
  assert.equal(ligne.oos.esperance, 0.25);
});
