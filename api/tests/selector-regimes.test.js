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
  Signals.detect = () => ({ status: 'confirme', strength: 0.9, reglesPour: ['R4'], confirmations:1, direction: 'BUY' });
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

test('selector requires actual distinct evidence, direction and minimum strength',()=>{
  const original=Signals.detect;
  const base={candles:bougies,meta:{symbol:'EURUSD',timeframe:'1h'},strategies:[fiche],regime:'trending'};
  try {
    for(const verdict of [
      {status:'confirme',strength:0.9,reglesPour:['R4'],confirmations:0,direction:'BUY'},
      {status:'confirme',strength:0.1,reglesPour:['R4'],confirmations:1,direction:'BUY'},
      {status:'confirme',strength:0.9,reglesPour:[],confirmations:1,direction:'BUY'}
    ]){
      Signals.detect=()=>verdict;
      assert.deepEqual(Selector.selectionner(base).retenues,[]);
    }
    Signals.detect=()=>({status:'confirme',strength:0.9,reglesPour:['R4'],confirmations:1,direction:'BUY'});
    assert.deepEqual(Selector.selectionner(base).retenues,[fiche.id]);
  }finally{Signals.detect=original;}
});
test('unknown rules and missing mandatory conditions never invoke generic detector',()=>{
  const Multi=require('../engine/signaux');
  const original=Signals.detect;
  try {
    Signals.detect=()=>{throw Error('must not invoke detector');};
    for(const moteur of [{regles:['R5']},{regles:[]},{regles:['R4'],obligatoires:['R1'],seuilRegles:1}]){
      const p=Signals.profilDepuisStrategie({...fiche,moteur});
      assert.equal(p.executable,false);
      const result=Multi.signalStrategie(bougies,{symbol:'EURUSD',timeframe:'1h'},p);
      assert.equal(result.status,'refuse');
      assert.equal(result.entree,null);
    }
  }finally{Signals.detect=original;}
});
