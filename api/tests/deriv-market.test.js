const test = require('node:test');
const assert = require('node:assert/strict');
const market = require('../sources/market');
const deriv = market.providerById('deriv');

test('Deriv public market uses v1 without credentials', () => {
  assert.equal(deriv.streamUrl(), 'wss://api.derivws.com/trading/v1/options/ws/public');
});
test('Deriv accepts valid numeric-string OHLC and rejects invalid updates', () => {
  const ohlc = { symbol:'R_75', open_time:1700000000, open:'100', high:'105', low:'98', close:'103' };
  const parse = value => deriv.parse({ msg_type:'ohlc', ohlc:value });
  assert.deepEqual(parse(ohlc), { symbol:'R_75', candle:{ t:1700000000000, o:100, h:105, l:98, c:103, v:0, closed:false } });
  for (const broken of [{close:null}, {close:'NaN'}, {high:99}, {low:104}, {open_time:0}, {symbol:''}]) {
    assert.equal(parse({...ohlc,...broken}), null);
  }
});
