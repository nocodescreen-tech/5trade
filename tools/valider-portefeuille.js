/**
 * LE TEST QUI COMPTE VRAIMENT : la stratégie ENTIÈRE, pas chaque famille.
 *
 * Découper en familles multiplie les essais et divise l'échantillon : aucune ne
 * peut passer seule. La question honnête est celle du portefeuille — tous les
 * signaux ensemble, sur 10 ans, après frais et glissement.
 *
 * On calcule le DSR de la série complète avec plusieurs comptes d'essais :
 *   7   = les familles de cette étude
 *   50  = hypothèse large, tous les réglages essayés depuis le début du projet
 */
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');
const V = require('../api/validite');

const SPREAD = { 'NQ=F': 1.00, 'ES=F': 0.25, 'BTC-USD': 12, 'GC=F': 0.30, 'CL=F': 0.02, 'EURUSD=X': 0.00012 };
const profil = [{ id: 'p', titre: 'T', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {} }];

console.log('  instrument   trades   espérance  Sharpe   DSR(7)  DSR(50)  DD simulé  survit');
console.log('  ' + '─'.repeat(80));

for (const [sym, spread] of Object.entries(SPREAD)) {
  const bougies = H.charger('yahoo', sym, '1d');
  if (!bougies || bougies.length < 300) continue;
  // Glissement = 1 spread, le test le plus dur déjà franchi.
  F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0,
    partMax: 0.15, parSymbole: { [sym]: { spread, glissement: spread } } });
  const r = B.lancer(bougies, { symbol: sym, timeframe: '1d' },
    { profils: profil, pas: 1, maxBougies: bougies.length, plafond: 20000,
      limiteTrades: 1e6, modele: false });
  const tr = (r.trades || []).filter(t => Number.isFinite(t.r)).sort((a, b) => a.at - b.at);
  if (tr.length < 200) { console.log(`  ${sym.padEnd(11)}  échantillon trop court (${tr.length})`); continue; }

  const rs = tr.map(t => t.r);
  const totale = rs.reduce((a, x) => a + x, 0);
  const sh = V.sharpe(rs);
  // Variance des Sharpe entre familles : la vraie mesure du bruit de sélection.
  const fam = new Map();
  for (const t of tr) {
    const k = String(t.concept || t.nom || '?').replace(/\s+[\d.,]+.*$/, '').trim();
    if (!fam.has(k)) fam.set(k, []);
    fam.get(k).push(t.r);
  }
  const sharpeFamilles = [...fam.values()].filter(a => a.length >= 25).map(a => V.sharpe(a));
  const variance = V.moments(sharpeFamilles).ecart ** 2 || 0.0004;

  const d7 = V.dsr(rs, 7, variance);
  const d50 = V.dsr(rs, 50, variance);

  // Drawdown de la courbe en R (pas de composition : on mesure la série).
  let cum = 0, pic = 0, dd = 0;
  for (const x of rs) { cum += x; pic = Math.max(pic, cum); dd = Math.min(dd, cum - pic); }

  const survit = d50 && d50.psr > 0.95;
  console.log(`  ${sym.padEnd(11)}  ${String(tr.length).padStart(6)}  `
    + `${(totale / tr.length).toFixed(4).padStart(9)}  ${sh.toFixed(3).padStart(6)}  `
    + `${(d7 ? d7.psr : 0).toFixed(3).padStart(6)}  ${(d50 ? d50.psr : 0).toFixed(3).padStart(7)}  `
    + `${dd.toFixed(0).padStart(9)} R  ${survit ? '  OUI' : '  non'}`);
}

F.configurer({ defaut: 0, commissionDefaut: 0, glissement: 0, partMax: 0.15, parSymbole: {} });
console.log('\nDSR(50) > 0,95 = l’avantage de la stratégie entière survit à 50 essais.');
