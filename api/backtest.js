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
// Nature de l'instrument : un backtest sur un RNG ne prouve rien.
const Instruments = require('./instruments');

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
  // Plafond surchargeable — réservé aux outils HORS LIGNE (mesure, dataset).
  // La route HTTP ne le passe jamais : un client ne doit pas pouvoir demander
  // 50 000 bougies et figer le serveur.
  const plafond = Math.min(Math.max(1, Number(options.plafond) || MAX_BOUGIES), 20000);
  const maxBougies = Math.min(Number(options.maxBougies) || 400, plafond);
  // Fenêtre vue par le moteur à chaque pas. Le direct ne voit que ~300 bougies :
  // laisser la fenêtre grandir jusqu'à tout l'historique rendait le backtest
  // quadratique ET infidèle au comportement réel.
  const largeur = Math.max(DEPART_MIN, Math.round(Number(options.fenetreMax) || MAX_BOUGIES));

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
  let ecartesModele = 0;
  let ecartesRR = 0;

  // Régime de tendance, précalculé SANS le futur : moyenne mobile et sa pente.
  // Les périodes sont paramétrables pour pouvoir vérifier que l'avantage ne
  // dépend pas d'un réglage chanceux (200 est la valeur de départ, pas une vérité).
  const filtreRegime = options.regime === true;
  const periodeSma = Math.max(20, Math.round(Number(options.regimeSma) || 200));
  const periodePente = Math.max(2, Math.round(Number(options.regimePente) || 20));
  const sma200 = new Array(n).fill(null), penteSma = new Array(n).fill(null);
  if (filtreRegime) {
    let somme = 0;
    for (let i = 0; i < n; i++) {
      somme += serie[i].c;
      if (i >= periodeSma) somme -= serie[i - periodeSma].c;
      if (i >= periodeSma - 1) {
        sma200[i] = somme / periodeSma;
        if (i >= periodeSma - 1 + periodePente && sma200[i - periodePente]) {
          penteSma[i] = (sma200[i] - sma200[i - periodePente]) / sma200[i - periodePente];
        }
      }
    }
  }
  let ecartesRegime = 0;

  for (let i = DEPART_MIN; i < n - 1; i += pas) {
    const fenetre = serie.slice(Math.max(0, i - largeur + 1), i + 1);

    let r;
    try {
      r = Multi.detecterTout(fenetre, meta, {
        profils,
        modele: options.modele,
        modeleSeuil: options.modeleSeuil,
        // Porte du rapport risque/rendement : absente en direct par défaut,
        // mesurée ici pour comparer les configurations.
        rrMin: options.rrMin
      });
    } catch {
      continue;                 // une fenêtre qui échoue ne doit pas arrêter le reste
    }
    evaluations++;

    // Combien de configurations ont été refusées parce que le coût dépasse le
    // risque : c'est la réponse à « ce marché est-il seulement tradable ? ».
    ecartesFrais += (r.ecartesFrais || []).length;
    ecartesModele += (r.ecartesModele || []).length;
    ecartesRR += (r.ecartesRR || []).length;

    // Filtre par SOURCE (motif, structure, strategie).
    // Mesuré sur 8 indices en quotidien : les signaux de stratégie valent
    // −0,04 R par trade et font tomber le DSR du portefeuille de 0,843 à 0,449.
    // Le filtre existe donc pour pouvoir les écarter — et le chiffre reste
    // visible dans `parSource`, pas caché.
    if (Array.isArray(options.sources) && options.sources.length) {
      const gardes = new Set(options.sources);
      r.signaux = (r.signaux || []).filter(s => gardes.has(s.source));
    }

    const futurs = serie.slice(i + 1);
    // Plusieurs détecteurs peuvent décrire le MÊME trade sur cette bougie
    // (même entrée, même stop) : une seule prise, les concepts se cumulent.
    const parCle = new Map();
    for (const s of r.signaux) {
      if (s.status !== 'confirme' && s.status !== 'surveiller') continue;
      if (!s.entree || !s.stop || !Array.isArray(s.objectifs) || !s.objectifs.length) continue;
      if (!s.sens || s.sens === 'neutre') continue;
      // FILTRE DE RÉGIME (optionnel). Mesuré sur NQ 1d : les trades dans le sens
      // de la tendance valent +25,73 % du risque, ceux contre la tendance
      // −10,31 % — et le système en prend autant des deux. Sur un panier de
      // 5 indices, écarter le contre-tendance fait passer l'espérance de
      // +6,20 % à +10,70 % par trade. Le régime est lu AVANT l'entrée : moyenne
      // 200 et sa pente, jamais le futur.
      if (filtreRegime) {
        const m = sma200[i], p = penteSma[i];
        if (m === null || p === null) { ecartesRegime++; continue; }
        const haussier = serie[i].c > m && p > 0;
        const baissier = serie[i].c < m && p < 0;
        const aligne = (s.sens === 'long' && haussier) || (s.sens === 'short' && baissier);
        if (!aligne) { ecartesRegime++; continue; }
      }
      // Aucune bougie FUTURE, ou pas assez pour aller au bout du suivi : le
      // trade ne peut pas être jugé. On ne l'ajoute pas. Sinon il sortait
      // « ouvert » avec un R nul — et le nombre de trades rendus ne
      // correspondait plus au nombre de trades clos.
      if (futurs.length < Journal.MAX_BOUGIES_SUIVI) continue;

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
        // ⚠️ `Number(null)` vaut 0 : un trade sans objectif se retrouvait avec un
        // rapport de ZÉRO et passait pour un vrai trade dans les statistiques.
        rr: (s.rr === null || s.rr === undefined || !Number.isFinite(Number(s.rr)))
          ? null : Number(s.rr),
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
    ...resumer(trades, { symbol: meta.symbol, timeframe: meta.timeframe,
      limiteTrades: options.limiteTrades }),
    at: n ? serie[n - 1].t : null,
    debut: n ? serie[0].t : null,
    bougies: n,
    // Ce que vaut le résultat : sur un instrument synthétique, rien.
    instrument: {
      synthetique: Instruments.synthetique(meta.symbol),
      avertissement: Instruments.avertissement(meta.symbol)
    },
    // Un backtest sur une poignée de bougies n'est pas un résultat : c'est une
    // anecdote. Le drapeau est calculé ici pour que l'écran ne puisse pas
    // l'oublier — 93 bougies, c'est 23 heures d'or en 15m.
    fiable: n >= 300,
    // Le nombre de marchés/temps réellement disponibles : le courtier rend
    // parfois moins de bougies que demandé (Deriv : 573 pour 800 en 15m forex).
    demandees: Math.round(Number(options.demandees) || 0) || null,
    pas,
    evaluations,
    ignoresDoublons,
    ecartesFrais,
    ecartesModele,
    ecartesRR,
    // Combien de signaux écartés parce qu'ils allaient CONTRE la tendance.
    // Mesuré : ces trades valent −10,31 % du risque sur NQ quand les trades
    // alignés valent +25,73 %.
    ecartesRegime,
    regime: filtreRegime
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
    // ── Le chiffre qui décide, et qui était invisible ──────────────────────
    // Un BE (objectif 1 pris, puis retour à l'entrée) est crédité de la MOITIÉ
    // du premier objectif : c'est une convention de gestion (clôture partielle,
    // stop à l'entrée), pas une certitude. Mesuré sur l'or 15m : +26,6 R avec
    // la convention, −70,0 R si un BE vaut zéro. Le signe du résultat tient donc
    // à cette seule hypothèse — elle doit être affichée, pas enfouie.
    ...(() => {
      const beTr = closes => closes.filter(t => t.resultat === 'be');
      const sommeBE = beTr(clos).reduce((a, t) => a + (Number.isFinite(t.r) ? t.r : 0), 0);
      // Ce que la convention AURAIT crédité : la moitié du premier objectif.
      // On le calcule même quand elle est désactivée, pour que l'écart soit
      // visible au lieu d'être une opinion.
      const theorique = beTr(clos).reduce((a, t) => {
        const risque = Math.abs(t.entree - t.stop);
        const o = (t.objectifs || [])[0];
        if (!risque || !Number.isFinite(o)) return a;
        const r1 = (t.sens === 'long' ? o - t.entree : t.entree - o) / risque;
        return a + (Number.isFinite(r1) ? r1 / 2 : 0);
      }, 0);
      const sansGestion = rTotal - sommeBE;
      return {
        gestionPartielle: Journal.gestionPartielleActive(),
        be: beTr(clos).length,
        beSomme: +sommeBE.toFixed(2),
        beTheorique: +theorique.toFixed(2),
        rTotalSansGestion: +sansGestion.toFixed(2),
        esperanceSansGestion: clos.length ? +(sansGestion / clos.length).toFixed(4) : null,
        poidsBePct: Math.abs(rTotal) > 0 ? +((sommeBE / Math.abs(rTotal)) * 100).toFixed(0) : null,
        signeDependDuBE: (rTotal > 0) !== (sansGestion > 0)
      };
    })(),
    // Combien de TYPES de configuration : 727 trades peuvent venir de 28
    // concepts seulement, répétés à des prix différents. Et surtout, la part que
    // représentent les trois types les plus fréquents — si trois motifs font 60 %
    // des prises, l'espérance affichée parle de ces trois motifs, pas du marché.
    ...(() => {
      const parType = {};
      for (const t of trades) if (t.identite) parType[t.identite] = (parType[t.identite] || 0) + 1;
      const parts = Object.values(parType).sort((a, b) => b - a);
      const total = trades.length || 1;
      return {
        types: parts.length,
        concentrationTop3: parts.length
          ? +((parts.slice(0, 3).reduce((a, b) => a + b, 0) / total) * 100).toFixed(1)
          : null
      };
    })(),
    // La liste rendue est plafonnée : une réponse HTTP de 20 000 trades n'a pas
    // de sens pour l'écran. Mais l'analyse hors ligne, elle, a besoin de TOUT —
    // mesurer une courbe de capital sur les 200 trades les plus récents ne dit
    // rien de la période. `limiteTrades` (défaut 200) lève le plafond.
    trades: trades.slice().sort((a, b) => b.at - a.at)
      .slice(0, Math.max(1, Math.round(Number(meta.limiteTrades) || 200)))
  };
}

module.exports = { lancer, resumer, MAX_BOUGIES, DEPART_MIN };
