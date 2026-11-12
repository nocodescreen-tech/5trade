/**
 * Les huit tests d'identification demandés, exécutés sur le code réel.
 * Aucune valeur inventée : on affiche ce que le classificateur répond.
 */
const C = require('../market-intelligence/instrument-classifier');
const M = require('../sources/market');

const CAS = [
  ['frxEURUSD', 'deriv', { classe: 'forex', base: 'EUR', quote: 'USD' }],
  ['frxGBPJPY', 'deriv', { classe: 'forex', base: 'GBP', quote: 'JPY' }],
  ['frxUSDJPY', 'deriv', { classe: 'forex', base: 'USD', quote: 'JPY' }],
  ['BTCUSDT', 'binance', { classe: 'crypto' }],
  ['R_75', 'deriv', { classe: 'synthetique' }],
  ['frxXAUUSD', 'deriv', { classe: 'metaux' }],
  ['EURUSDT', 'binance', { proxy: true }],
  ['ZZZINCONNU', 'deriv', { classe: 'inconnu' }]
];

console.log('symbole       | classe       | base/cote | reconnu | proxy      | raisons');
for (const [sym, prov, attendu] of CAS) {
  const c = C.classifier(sym, { provider: prov });
  console.log(
    String(sym).padEnd(13), '|',
    String(c.classe).padEnd(12), '|',
    String((c.deviseBase || '—') + '/' + (c.deviseCote || '—')).padEnd(9), '|',
    String(c.reconnu).padEnd(7), '|',
    String(c.proxy ? 'oui' : 'non').padEnd(10), '|',
    (c.raisons || []).join(' · ').slice(0, 70)
  );
  void attendu;
}

console.log('\nContrôles de cohérence :');
const paires = [['EURUSD', 'EURUSD'], ['USDEUR', 'USDEUR'], ['EUR/USD', 'EUR/USD'], ['EURUSDX', 'EURUSDX'], ['EURXUSD', 'EURXUSD']];
for (const [sym] of paires) {
  const c = C.classifier(sym);
  console.log(' ', sym.padEnd(10), '→', c.classe.padEnd(12), '| base/cote:', (c.deviseBase || '—') + '/' + (c.deviseCote || '—'));
}

console.log('\nRoutage fournisseur :');
for (const [sym, prov] of [['R_75', 'deriv'], ['R_75', 'binance'], ['R_75', 'nexistepas'], ['BTCUSDT', 'binance'], ['BTCUSDT', 'deriv']]) {
  try {
    const p = M.providerById(prov);
    M.verifierSymbole(p, sym);
    console.log(' ', (sym + '@' + prov).padEnd(20), '→ accepté (' + p.id + ')');
  } catch (e) {
    console.log(' ', (sym + '@' + prov).padEnd(20), '→ REFUSÉ :', e.message.slice(0, 62));
  }
}
