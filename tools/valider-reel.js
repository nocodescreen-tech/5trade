/**
 * VALIDER SUR UN MARCHÉ RÉEL — et dire si l'avantage survit.
 *
 * Usage : node tools/valider-reel.js [GC=F] [1h] [2]
 *
 * 1. charge l'historique réel (Yahoo) ;
 * 2. rejoue le moteur, bougie par bougie, avec les frais ;
 * 3. regroupe les trades par concept et par jour ;
 * 4. applique Sharpe, PSR, Deflated Sharpe, longueur minimale et PBO ;
 * 5. refait la passe avec des coûts doublés : un avantage qui meurt au premier
 *    supplément de friction n'était pas un avantage.
 */
const path = require('path');
const H = require('../api/historique');
const B = require('../api/backtest');
const F = require('../api/frais');
const V = require('../api/validite');
const I = require('../api/instruments');

const [sym = 'GC=F', tf = '1h', pasArg = '2'] = process.argv.slice(2);
const pas = Math.max(1, Number(pasArg) || 2);

const profils = [{
  id: 'p', titre: 'Toutes règles', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {}
}];

/**
 * Clé de regroupement stable : « Support 4271.41 » et « Support 4102.9 » sont le
 * MÊME concept. Sans cette normalisation, chaque niveau devient une colonne et la
 * PBO calcule sur 976 colonnes d'un trade chacune — un chiffre sans sens.
 */
const cleConcept = t => String(t.concept || t.strategie || t.nom || '?')
  .replace(/\s+[\d.,]+.*$/, '')     // retire le niveau et ce qui suit
  .trim() || '?';

function matriceParJour(trades) {
  const jours = [...new Set(trades.map(t => Math.floor(t.at / 86400000)))].sort((a, b) => a - b);
  const concepts = [...new Set(trades.map(cleConcept))].sort();
  const idx = new Map(jours.map((j, i) => [j, i]));
  const col = new Map(concepts.map((c, i) => [c, i]));
  const m = jours.map(() => new Array(concepts.length).fill(0));
  for (const t of trades) {
    if (!Number.isFinite(t.r)) continue;
    m[idx.get(Math.floor(t.at / 86400000))][col.get(cleConcept(t))] += t.r;
  }
  return { m, concepts, jours };
}

function analyse(nom, trades, essais) {
  // Découpage chronologique : les 60 % premiers servent à découvrir, les 40 %
  // derniers à vérifier. Un concept qui ne tient que sur la première moitié est
  // un artefact de cette période, pas un avantage.
  const tries = [...trades].filter(t => Number.isFinite(t.r)).sort((a, b) => a.at - b.at);
  const coupe = tries[Math.floor(tries.length * 0.6)]?.at ?? Infinity;

  const parConcept = new Map();
  for (const t of tries) {
    const k = cleConcept(t);
    if (!parConcept.has(k)) parConcept.set(k, { tous: [], debut: [], fin: [] });
    const e = parConcept.get(k);
    e.tous.push(t.r);
    (t.at < coupe ? e.debut : e.fin).push(t.r);
  }
  const configs = [...parConcept.entries()]
    .filter(([, e]) => e.tous.length >= 30)
    .map(([k, e]) => ({ nom: k, rendements: e.tous, debut: e.debut, fin: e.fin }));

  if (!configs.length) { console.log(`\n${nom} : aucune configuration avec ≥ 30 trades`); return null; }

  const nEssais = essais || configs.length;
  const lignes = V.tableau(configs, { nEssais });
  const { m } = matriceParJour(trades);
  const res = V.pbo(m, { blocs: 10 });

  console.log(`\n══ ${nom} · ${tries.length} trades notés · ${configs.length} concepts · essais comptés : ${essais || configs.length}`);
  console.log('  concept'.padEnd(28), 'n'.padStart(5), 'totalR'.padStart(8), 'espér.'.padStart(7),
    'IS'.padStart(7), 'OOS'.padStart(7), 'Sharpe'.padStart(7), 'PSR'.padStart(6), 'tient', 'survit');
  for (const l of lignes) {
    const c = configs.find(x => x.nom === l.nom);
    const esp = rs => (rs.length ? rs.reduce((a, x) => a + x, 0) / rs.length : NaN);
    const is = esp(c.debut), oos = esp(c.fin);
    const tient = Number.isFinite(is) && Number.isFinite(oos) && is > 0 && oos > 0;
    console.log('  ' + l.nom.slice(0, 26).padEnd(26), String(l.n).padStart(5),
      String(l.totalR).padStart(8), l.esperance.toFixed(3).padStart(7),
      (Number.isFinite(is) ? is.toFixed(3) : '—').padStart(7),
      (Number.isFinite(oos) ? oos.toFixed(3) : '—').padStart(7),
      l.sharpe.toFixed(3).padStart(7), String(l.psr).padStart(6),
      tient ? ' oui' : ' NON', l.survit ? '  OUI' : '  non');
  }
  if (res) {
    console.log(`  PBO : ${(res.pbo * 100).toFixed(1)} % (${res.combinaisons} combinaisons, `
      + `${res.T} jours × ${res.N} concepts) — ${res.pbo > 0.5
        ? 'la meilleure configuration en apprentissage ne tient pas hors échantillon'
        : 'la sélection tient hors échantillon'}`);
  }
  const retenus = lignes.filter(l => l.survit);
  console.log(`  → ${retenus.length} concept(s) sur ${configs.length} survivent au Deflated Sharpe`
    + (retenus.length ? ` : ${retenus.map(l => l.nom).join(', ')}` : ''));
  return { lignes, pbo: res && res.pbo, configs, retenus };
}

(async () => {
  const bougies = H.charger('yahoo', sym, tf);
  if (!bougies || bougies.length < 500) throw new Error(`historique insuffisant : ${sym} ${tf}`);
  console.log(`marché réel : ${sym} ${tf} · ${bougies.length} bougies · `
    + `${new Date(bougies[0].t).toISOString().slice(0, 10)} → ${new Date(bougies.at(-1).t).toISOString().slice(0, 10)}`
    + ` · synthétique : ${I.synthetique(sym)}`);

  const lancer = (spread) => {
    F.configurer({ defaut: 0, commissionDefaut: 0, parSymbole: { [sym]: { spread } } });
    return B.lancer(bougies, { symbol: sym, timeframe: tf },
      // `plafond` lève la limite des 800 bougies : réservé à l'analyse hors ligne.
      { profils, pas, maxBougies: bougies.length, plafond: 20000,
        limiteTrades: 1e6, modele: false }).trades || [];
  };

  const base = spreadDe(sym);
  const t1 = lancer(base);
  const r1 = analyse(`${sym} — frais nominaux (spread ${base})`, t1);

  const t2 = lancer(base * 2);
  const r2 = analyse(`${sym} — coûts DOUBLÉS (spread ${(base * 2).toFixed(4)})`, t2);

  F.configurer({ defaut: 0, commissionDefaut: 0, parSymbole: {} });

  if (r1 && r2) {
    const e1 = r1.lignes.reduce((a, l) => a + l.esperance * l.n, 0) / r1.lignes.reduce((a, l) => a + l.n, 0);
    const e2 = r2.lignes.reduce((a, l) => a + l.esperance * l.n, 0) / r2.lignes.reduce((a, l) => a + l.n, 0);
    const perte = e1 !== 0 ? ((e1 - e2) / Math.abs(e1)) * 100 : null;

    console.log(`\nRÉSISTANCE AUX COÛTS : espérance ${e1.toFixed(4)} R → ${e2.toFixed(4)} R`
      + (perte === null ? '' : ` (perte de ${perte.toFixed(0)} % de l'espérance)`));

    // Le verdict doit être juste dans les quatre cas : positif→négatif,
    // négatif→plus négatif, positif→positif dégradé, négatif→moins négatif.
    if (e1 > 0 && e2 <= 0) {
      console.log('  → l’avantage MEURT quand les coûts doublent : il n’était pas robuste.');
    } else if (e1 > 0 && e2 > 0 && perte > 50) {
      console.log('  → il survit, mais en perdant plus de la moitié : fragile, à ne pas annoncer.');
    } else if (e1 > 0) {
      console.log('  → il survit à des coûts doublés.');
    } else {
      console.log('  → il n’y avait pas d’avantage à défendre : les deux passes sont perdantes.');
    }
  }
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });

/** Spread de départ par marché, en unités de prix (ordres de grandeur broker). */
function spreadDe(s) {
  if (/^GC=F$/.test(s)) return 0.30;        // or, 30 cents
  if (/^EURUSD=X$/.test(s)) return 0.00012; // 1,2 pip
  if (/^BTC-USD$/.test(s)) return 12;       // ~12 $
  return 0.001;
}
