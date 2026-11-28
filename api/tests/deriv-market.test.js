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

test('live streams keep independent provider/timeframe subscriptions', { timeout: 10000 }, async () => {
  const { WebSocketServer } = require('ws');
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  const { once } = require('node:events');
  await once(server, 'listening');
  const original = deriv.streamUrl;
  const subscriptions = [];
  const stops = [];
  const received = [];
  const waitFor = async predicate => {
    const until = Date.now() + 3000;
    while (!predicate()) {
      if (Date.now() > until) throw new Error('Subscription not received');
      await new Promise(r => setTimeout(r, 15));
    }
  };
  server.on('connection', socket => socket.on('message', raw => {
    const req = JSON.parse(raw.toString());
    subscriptions.push({ socket, req });
  }));
  try {
    deriv.streamUrl = () => 'ws://127.0.0.1:' + server.address().port;
    stops.push(market.watch('R_75', '1m', c => received.push(['1m', c]), 'deriv'));
    stops.push(market.watch('R_25', '5m', c => received.push(['5m', c]), 'deriv'));
    await waitFor(() => subscriptions.length === 2);
    assert.notEqual(subscriptions[0].socket, subscriptions[1].socket);
    const first = subscriptions.find(s => s.req.ticks_history === 'R_75');
    const second = subscriptions.find(s => s.req.ticks_history === 'R_25');
    const send = (s, symbol) => s.socket.send(JSON.stringify({msg_type:'ohlc',ohlc:{symbol,open_time:1700000100,open:'100',high:'105',low:'98',close:'103'}}));
    send(first, 'R_25'); // wrong symbol is ignored on this connection
    send(first, 'R_75');
    send(second, 'R_25');
    await waitFor(() => received.length >= 2);
    assert.deepEqual(received.map(r => r[0]).sort(), ['1m','5m']);
    stops.shift()();
    await waitFor(() => first.socket.readyState === 3);
    assert.equal(second.socket.readyState, 1);
  } finally {
    for (const stop of stops) stop();
    market.closeStream();
    deriv.streamUrl = original;
    for (const socket of server.clients) socket.terminate();
    await new Promise(resolve => server.close(resolve));
  }
});
