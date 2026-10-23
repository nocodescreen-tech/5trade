/**
 * ANALYSE PAR CONCEPT ET PAR STRATÉGIE — ce que le panneau « Modules d'analyse »
 * ne savait pas faire.
 *
 * Il affichait du JSON brut. Ici on rejoue le moteur sur un historique long et on
 * rend un tableau utilisable : combien de trades, quelle espérance en R, quelle
 * régularité entre les deux moitiés de la période, et surtout — est-ce que ça
 * survit au nombre d'essais (DSR) et à la sélection (PBO) ?
 *
 * Le regroupement se fait par FAMILLE (« Support 4271.41 » et « Support 4102.9 »
 * sont le même concept), sinon chaque niveau devient une ligne et le tableau ne
 * dit rien.
 */
const H = require('./historique');
const B = require('./backtest');
const F = require('./frais');
const V = require('./validite');
const I = require('./instruments');

const PROFIL_TOUT = [{
  id: 'toutes', titre: 'Toutes règles', regles: ['R1', 'R2', 'R3', 'R4'],
  seuilRegles: 1, seuilForce: 0.2, filtres: [], timeframes: [], parametres: {}
}];

/** Famille stable : on retire le niveau collé au nom. */
const famille = (t, group) => {
  const brut = group === 'strategie'
    ? (t.strategie || t.nom)
    : (t.concept || t.strategie || t.nom);
  return String(brut || '?').replace(/\s+[\d.,]+.*$/, '').trim() || '?';
};

/** Charge l'historique : disque d'abord (long), réseau ensuite. */
async function serie({ symbol, tf, provider }) {
  const src = provider || (I.synthetique(symbol) || /^frx|cry|^[A-Z]{3}_/i.test(symbol) ? 'deriv' : 'yahoo');
  const local = H.charger(src, symbol, tf);
  if (local && local.length >= 200) return { bougies: local, source: `${src} (disque)` };
  const r = await H.telecharger({ symbol, tf, nombre: 0, provider: src });
  return { bougies: H.charger(src, symbol, tf), source: `${src} (réseau, ${r.obtenues} bougies)` };
}

/**
 * @param {{symbol:string, tf?:string, provider?:string, group?:'concept'|'strategie',
 *          pas?:number, bougies?:number}} opts
 */
async function analyser(opts = {}) {
  const symbol = String(opts.symbol || '').toUpperCase();
  if (!symbol) throw new Error('symbol est requis');
  const tf = opts.tf || '1h';
  const group = opts.group === 'strategie' ? 'strategie' : 'concept';
  const pas = Math.max(1, Math.round(Number(opts.pas) || 3));
  const bougies = Math.min(Math.max(Math.round(Number(opts.bougies) || 2000), 300), 20000);

  const { bougies: toutes, source } = await serie({ symbol, tf, provider: opts.provider });
  if (!toutes || toutes.length < 200) throw new Error(`historique insuffisant pour ${symbol} ${tf}`);
  const serieCourte = toutes.slice(-bougies);

  const r = B.lancer(serieCourte, { symbol, timeframe: tf },
    { profils: PROFIL_TOUT, pas, maxBougies: serieCourte.length,
      plafond: 20000, limiteTrades: 1e6, modele: false });

  const trades = (r.trades || []).filter(t => Number.isFinite(t.r)).sort((a, b) => a.at - b.at);
  const coupe = trades[Math.floor(trades.length * 0.6)]?.at ?? Infinity;

  const groupes = new Map();
  for (const t of trades) {
    const k = famille(t, group);
    if (!groupes.has(k)) groupes.set(k, { tous: [], debut: [], fin: [] });
    const g = groupes.get(k);
    g.tous.push(t.r);
    (t.at < coupe ? g.debut : g.fin).push(t.r);
  }

  const configs = [...groupes.entries()]
    .filter(([, g]) => g.tous.length >= 20)
    .map(([nom, g]) => ({ nom, rendements: g.tous, debut: g.debut, fin: g.fin }));

  if (!configs.length) {
    return { symbol, tf, group, source, bougies: serieCourte.length, trades: trades.length,
      lignes: [], pbo: null, avertissement: I.avertissement(symbol),
      note: 'Aucune famille avec au moins 20 trades sur cette période.' };
  }

  // Matrice jours × familles pour le PBO.
  const jours = [...new Set(trades.map(t => Math.floor(t.at / 86400000)))].sort((a, b) => a - b);
  const idx = new Map(jours.map((j, i) => [j, i]));
  const cols = configs.map(c => c.nom);
  const matrice = jours.map(() => new Array(cols.length).fill(0));
  for (const t of trades) {
    const c = cols.indexOf(famille(t, group));
    if (c >= 0) matrice[idx.get(Math.floor(t.at / 86400000))][c] += t.r;
  }
  const pboRes = V.pbo(matrice, { blocs: 10 });

  const tableau = V.tableau(configs, { nEssais: configs.length });
  const lignes = tableau.map(l => {
    const c = configs.find(x => x.nom === l.nom) || { debut: [], fin: [] };
    const moy = rs => (rs.length ? rs.reduce((a, x) => a + x, 0) / rs.length : null);
    const is = moy(c.debut);
    const oos = moy(c.fin);
    return { ...l, is: is === null ? null : +is.toFixed(4),
      oos: oos === null ? null : +oos.toFixed(4),
      tient: is !== null && oos !== null && is > 0 && oos > 0 };
  });

  return {
    symbol, tf, group, source,
    bougies: serieCourte.length,
    periode: { debut: serieCourte[0].t, fin: serieCourte[serieCourte.length - 1].t },
    trades: trades.length,
    esperance: +(trades.reduce((a, t) => a + t.r, 0) / trades.length).toFixed(4),
    totalR: +trades.reduce((a, t) => a + t.r, 0).toFixed(2),
    gestionPartielle: require('./journal-signaux').gestionPartielleActive(),
    synthetique: I.synthetique(symbol),
    avertissement: I.avertissement(symbol),
    essais: configs.length,
    pbo: pboRes ? +pboRes.pbo.toFixed(4) : null,
    pboDetail: pboRes,
    lignes
  };
}

/** CSV du tableau : ce qui s'exporte, ce qui se recalcule ailleurs. */
function versCsv(res) {
  const q = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const entetes = ['famille', 'trades', 'totalR', 'esperance_R', 'sharpe', 'psr',
    'is_R', 'oos_R', 'tient_hors_echantillon', 'survit_deflated_sharpe', 'longueur_minimale'];
  const lignes = [entetes.join(';')];
  for (const l of res.lignes || []) {
    lignes.push([
      q(l.nom), l.n, l.totalR, l.esperance, l.sharpe, l.psr,
      l.is ?? '', l.oos ?? '', l.tient ? 'oui' : 'non',
      l.survit ? 'oui' : 'non', l.longueurMinimale
    ].join(';'));
  }
  lignes.push('');
  lignes.push(`# ${res.symbol} ${res.tf} · ${res.group} · ${res.trades} trades · `
    + `${res.bougies} bougies · PBO ${res.pbo === null ? 'n/a' : (res.pbo * 100).toFixed(1) + ' %'}`
    + ` · essais ${res.essais} · gestion partielle ${res.gestionPartielle ? 'activée' : 'désactivée'}`);
  return lignes.join('\n');
}

module.exports = { analyser, versCsv, famille };
