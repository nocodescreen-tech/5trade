/**
 * 5trade — BACKTEST.
 *
 * Le manque le plus grave du produit : rien ne prouvait que le moteur gagne. Un
 * journal ne dit que ce qui s'est passé depuis qu'on l'écoute ; un backtest dit
 * ce que le moteur AURAIT donné sur un historique, avec le même code que le
 * direct — aucune règle réécrite pour l'occasion.
 *
 * Méthode (assumée, écrite ici) :
 *  1. On avance bougie par bougie. À chaque pas, `Multi.detecterTout` voit
 *     UNIQUEMENT le passé (aucune bougie future dans la fenêtre) : pas de
 *     lecture rétrospective.
 *  2. Chaque signal retenu qui porte des niveaux devient un trade, évalué par
 *     `JournalSignaux.evaluer` — la MÊME fonction que le journal live, donc les
 *     mêmes conventions (stop prioritaire sur objectif, BE après objectif 1).
 *  3. Un signal qui reste ouvert pendant N bougies ne crée PAS N trades : on
 *     n'ouvre une nouvelle occurrence de la même identité qu'une fois la
 *     précédente résolue. Sinon la même configuration compterait dix fois.
 *  4. Les trades non résolus à la fin de l'historique sont comptés « en cours »
 *     et EXCLUS du taux de réussite — les compter comme gagnants serait flatteur.
 *
 * Coût IA : zéro. Tout est local.
 */

const Multi = require('./signaux');
const Journal = require('./journal-signaux');
const Frais = require('./frais');

const DEPART_MIN = 30;        // bougies nécessaires avant de juger
const MAX_BOUGIES = 800;

/**
 * @param {Array} candles bougies OHLCV (ordre chronologique)
 * @param {{symbol?:string, timeframe?:string}} meta
 * @param {{profils?:Array, pas?:number, maxBougies?:number}} [options]
 */
function lancer(candles, meta = {}, options = {}) {
  const profils = Array.isArray(options.profils) ? options.profils.filter(Boolean) : [];
  const pas = Math.max(1, Math.round(Number(options.pas) || 2));
  const maxBougies = Math.min(Number(options.maxBougies) || 400, MAX_BOUGIES);

  const propres = (candles || [])
    .filter(c => c && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c))
    .sort((a, b) => a.t - b.t);

  // On garde la fin de l'historique : c'est la période la plus comparable aux
  // conditions actuelles, et la plus courte à calculer.
  const serie = propres.length > maxBougies ? propres.slice(-maxBougies) : propres;
  const n = serie.length;
  if (n < DEPART_MIN + 10) {
    return {
      indisponible: true,
      raison: `Historique trop court (${n} bougies, ${DEPART_MIN + 10} minimum).`,
      symbol: meta.symbol || null, timeframe: meta.timeframe || null
    };
  }

  const trades = [];
  // identité -> index de la bougie où l'occurrence précédente s'est résolue
  const resolues = new Map();
  let evaluations = 0;
  let ignoresDoublons = 0;
  let ecartesFrais = 0;

  for (let i = DEPART_MIN; i < n - 1; i += pas) {
    const fenetre = serie.slice(0, i + 1);

    let r;
    try {
      r = Multi.detecterTout(fenetre, meta, { profils });
    } catch {
      continue;                 // une fenêtre qui échoue ne doit pas arrêter le reste
    }
    evaluations++;

    // Combien de configurations ont été refusées parce que le coût dépasse le
    // risque : c'est la réponse à « ce marché est-il seulement tradable ? ».
    ecartesFrais += (r.ecartesFrais || []).length;

    const futurs = serie.slice(i + 1);
    // Plusieurs détecteurs peuvent décrire le MÊME trade sur cette bougie
    // (même entrée, même stop) : une seule prise, les concepts se cumulent.
    const parCle = new Map();
    for (const s of r.signaux) {
      if (s.status !== 'confirme' && s.status !== 'surveiller') continue;
      if (!s.entree || !s.stop || !Array.isArray(s.objectifs) || !s.objectifs.length) continue;
      if (!s.sens || s.sens === 'neutre') continue;

      const identite = `${s.id}|${s.sens}`;
      const dejaResolueA = resolues.get(identite);
      // Encore ouverte au moment où on la retrouve : on ne rouvre pas.
      if (dejaResolueA !== undefined && dejaResolueA > i) { ignoresDoublons++; continue; }

      // Même entrée ET même stop sur cette bougie = un seul trade.
      const cleTrade = `${s.sens}|${Number(s.entree)}|${Number(s.stop)}`;
      const jumeau = parCle.get(cleTrade);
      if (jumeau) { jumeau.concepts.push(s.nom); continue; }

      const trade = {
        at: serie[i].t,
        index: i,
        // Le symbole est nécessaire pour appliquer le BON spread : sans lui,
        // tous les trades tombaient sur le coût par défaut.
        symbol: meta.symbol || null,
        timeframe: meta.timeframe || null,
        identite,
        id: s.id,
        source: s.source,
        nom: s.nom,
        concepts: [s.nom],
        strategie: s.strategie || null,
        concept: s.concept || null,
        sens: s.sens,
        force: s.force || 0,
        conditionsOk: (s.conditions || []).filter(c => c.ok).length,
        conditionsTotal: (s.conditions || []).length,
        alignement: s.structureContexte ? s.structureContexte.alignement : null,
        position: s.structureContexte ? s.structureContexte.position : null,
        entree: Number(s.entree),
        stop: Number(s.stop),
        objectifs: s.objectifs.map(Number).filter(Number.isFinite),
        resultat: 'ouvert',
        atteintTP1: false, atteintTP2: false, toucheSL: false, retourEntree: false,
        bougiesSuivies: 0
      };

      Journal.evaluer(trade, futurs);
      trades.push(trade);
      parCle.set(cleTrade, trade);

      // On mémorise jusqu'où cette occurrence court, pour ne pas la recompter.
      const idxFin = trade.leveLe
        ? Math.max(i, serie.findIndex(c => c.t === trade.leveLe))
        : n - 1;
      resolues.set(identite, idxFin);
    }
  }

  return {
    ...resumer(trades, { symbol: meta.symbol, timeframe: meta.timeframe }),
    at: n ? serie[n - 1].t : null,
    debut: n ? serie[0].t : null,
    bougies: n,
    pas,
    evaluations,
    ignoresDoublons,
    ecartesFrais
  };
}

const CLOS = new Set(['tp1', 'tp2', 'be', 'sl', 'expire']);

function resumer(trades, meta = {}) {
  const clos = trades.filter(t => CLOS.has(t.resultat));
  // Définition UNIQUE, appliquée partout (et identique dans journal-signaux) :
  //   gagné  = objectif atteint (tp1 ou tp2)
  //   perdu  = stop touché
  //   BE     = objectif 1 puis retour à l'entrée — ni gain ni perte, compté à part
  //   expiré = rien touché dans la fenêtre — compté à part
  // Compter le BE comme un gain gonflait le taux ; le compter comme une perte le
  // plombait. Et deux définitions dans le même payload (global vs par stratégie)
  // affichaient « 48,6 % » à côté de « 35,5 % » pour la même chose.
  const gagnes = clos.filter(t => t.resultat === 'tp1' || t.resultat === 'tp2');
  const perdus = clos.filter(t => t.resultat === 'sl');
  const be = clos.filter(t => t.resultat === 'be');
  const decides = gagnes.length + perdus.length;
  const rTotal = clos.reduce((a, t) => a + (Number.isFinite(t.r) ? t.r : 0), 0);

  // Brut contre net : le backtest doit pouvoir dire ce que les frais coûtent,
  // et à partir de quel spread le système cesse d'être rentable.
  const brutDe = t => (Number.isFinite(t.rBrut) ? t.rBrut : t.r);
  const rTotalBrut = clos.reduce((a, t) => a + (Number.isFinite(brutDe(t)) ? brutDe(t) : 0), 0);
  const avecCout = clos.filter(t => t.cout && Number.isFinite(t.cout.enR));
  const fraisMoyenR = avecCout.length
    ? +(avecCout.reduce((a, t) => a + t.cout.enR, 0) / avecCout.length).toFixed(4)
    : 0;
  const critique = clos.length ? +(rTotalBrut / clos.length).toFixed(4) : null;

  const agreger = (cle) => {
    const m = {};
    for (const t of clos) {
      const k = cle(t);
      if (!k) continue;
      if (!m[k]) m[k] = { total: 0, gagnes: 0, perdus: 0, be: 0, expires: 0, r: 0 };
      const p = m[k];
      p.total++;
      p.r += Number.isFinite(t.r) ? t.r : 0;
      if (t.resultat === 'sl') p.perdus++;
      else if (t.resultat === 'be') p.be++;
      else if (t.resultat === 'expire') p.expires++;
      else p.gagnes++;
    }
    // Taux calculé sur les décidés : les expirations ne sont ni gain ni perte.
    for (const k of Object.keys(m)) {
      const d = m[k].gagnes + m[k].perdus;
      m[k].tauxReussite = d ? +((m[k].gagnes / d) * 100).toFixed(1) : null;
      m[k].rMoyen = m[k].total ? +(m[k].r / m[k].total).toFixed(2) : null;
      // Sans arrondi, l'écran affichait « 28.160000000000004 R » : la somme de
      // flottants se voit dès qu'elle est affichée telle quelle.
      m[k].r = +m[k].r.toFixed(2);
    }
    return m;
  };

  // Courbe de capital en R : l'ordre chronologique des trades compte.
  const ordonnes = clos.slice().sort((a, b) => a.at - b.at);
  let cumul = 0;
  const courbe = ordonnes.map(t => {
    cumul += Number.isFinite(t.r) ? t.r : 0;
    return +cumul.toFixed(2);
  });

  return {
    symbol: meta.symbol || null,
    timeframe: meta.timeframe || null,
    total: trades.length,
    clos: clos.length,
    enCours: trades.filter(t => t.resultat === 'ouvert').length,
    parResultat: trades.reduce((a, t) => { a[t.resultat] = (a[t.resultat] || 0) + 1; return a; }, {}),
    gagnes: gagnes.length,
    perdus: perdus.length,
    // Les BE sont exposés à part : ils ne sont ni un gain ni une perte.
    be: be.length,
    expires: clos.filter(t => t.resultat === 'expire').length,
    tauxReussite: decides ? +((gagnes.length / decides) * 100).toFixed(1) : null,
    rTotal: +rTotal.toFixed(2),
    rMoyen: clos.length ? +(rTotal / clos.length).toFixed(2) : null,
    // Espérance par trade PRIS (BE et expirations compris) : c'est le chiffre
    // qui dit si le moteur vaut quelque chose, bien plus qu'un taux de réussite.
    esperance: clos.length ? +(rTotal / clos.length).toFixed(2) : null,
    rTotalBrut: +rTotalBrut.toFixed(2),
    esperanceBrute: clos.length ? +(rTotalBrut / clos.length).toFixed(2) : null,
    fraisMoyenR,
    fraisActifs: Frais.actifs(),
    coutCritique: critique,
    parSource: agreger(t => t.source),
    parSens: agreger(t => t.sens),
    parStrategie: agreger(t => t.strategie || (t.source === 'motif' ? t.nom : 'structure du marché')),
    parMotif: agreger(t => (t.source === 'motif' ? t.nom : null)),
    courbeR: courbe,
    trades: trades.slice().sort((a, b) => b.at - a.at).slice(0, 200)
  };
}

module.exports = { lancer, resumer, MAX_BOUGIES, DEPART_MIN };
