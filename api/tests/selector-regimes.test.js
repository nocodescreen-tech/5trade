const test = require('node:test');
const assert = require('node:assert/strict');
const Signals = require('../engine/signals');
const Selector = require('../strategy-engine/selector');

const fiche = {
  id: 'fibo-retracement', title: 'Retracement Fibonacci en tendance',
  marches: ['forex'], supportedRegimes: ['trending'],
  moteur: { regles: ['R4'], seuilRegles: 1, seuilForce: 0.5, timeframes: ['1h'] }
};
const bougies = Array.from({ length: 40 }, (_, i) => ({
  t: i * 3600000, o: 1 + i * 0.001, h: 1.002 + i * 0.001,
  l: 0.998 + i * 0.001, c: 1.001 + i * 0.001, closed: true
}));

test('le profil conserve les régimes propres au setup', () => {
  assert.deepEqual(Signals.profilDepuisStrategie(fiche).regimes, ['trending']);
});

test('un setup limité à trending reste refusé si le régime est absent ou incompatible', () => {
  const original = Signals.detect;
  Signals.detect = () => ({ status: 'confirme', force: 0.9, reglesActives: ['R4'], direction: 'BUY' });
  try {
    const base = { candles: bougies, meta: { symbol: 'EURUSD', timeframe: '1h' }, strategies: [fiche] };
    const inconnu = Selector.selectionner({ ...base, regime: null });
    const range = Selector.selectionner({ ...base, regime: 'ranging' });
    const tendance = Selector.selectionner({ ...base, regime: 'trending' });
    assert.deepEqual(inconnu.retenues, []);
    assert.match(inconnu.candidates[0].motif, /regime non determine/i);
    assert.deepEqual(range.retenues, []);
    assert.match(range.candidates[0].motif, /régime incompatible/i);
    assert.deepEqual(tendance.retenues, ['fibo-retracement']);
  } finally { Signals.detect = original; }
});
