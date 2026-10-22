/**
 * 5trade — GESTION DU RISQUE.
 *
 * Le problème résolu : le moteur savait dire « ce trade vaut 0,28 R en espérance »
 * et rien d'autre. Aucune taille de position, aucun plafond de perte, aucune
 * limite d'exposition. Un avantage statistique sans ces garde-fous ne meurt pas
 * de mauvais signaux : il meurt d'une seule série perdante, ou d'avoir mis trois
 * fois le même pari (or + argent + un indice qui suit l'or).
 *
 * Trois idées, dans l'ordre d'importance :
 *
 *  1. ON RISQUE UNE FRACTION FIXE DU CAPITAL, jamais un montant. La taille se
 *     déduit de la distance au stop : `taille = (capital × risque%) / |entrée − stop|`.
 *     Un stop large donne une petite position, un stop serré une plus grosse —
 *     c'est le risque en euros qui reste constant, pas la taille.
 *
 *  2. LES PLAFONDS SONT VÉRIFIÉS AVANT LA PRISE, pas après : perte journalière,
 *     nombre de positions simultanées, exposition par marché, exposition totale.
 *     Un garde-fou qui ne bloque rien n'est pas un garde-fou.
 *
 *  3. TOUT REFUS EST CHIFFRÉ ET REMONTÉ : « refusé — perte du jour −3,4 % pour un
 *     plafond à 3 % ». Une limite muette pousse à la contourner.
 *
 * Ce module ne passe AUCUN ordre : il dit ce qui est permis et de quelle taille.
 * C'est ce qui manque entre « un signal » et « un système ».
 *
 * Config : data/risque.json (surchargeable par RISQUE_FICHIER — même doctrine
 * que ALERTS_FICHIER / JOURNAL_SIGNAUX_FICHIER / FRAIS_FICHIER).
 */

const fs = require('fs');
const path = require('path');

const FICHIER = process.env.RISQUE_FICHIER
  || path.join(__dirname, '..', 'data', 'risque.json');

/**
 * Valeurs par défaut VOLONTAIREMENT prudentes. Elles ne sont pas des
 * recommandations de trading : ce sont des limites de sécurité, réglables.
 */
const DEFAUT = {
  capital: 1000,          // capital de référence (unité de compte de l'utilisateur)
  risquePct: 1,           // % du capital risqué par trade
  maxPerteJourPct: 3,     // arrêt des prises si la perte du jour atteint ce %
  maxSimultanes: 5,       // positions ouvertes en même temps
  // Les plafonds portent sur le RISQUE ENGAGÉ, pas sur le notionnel.
  // Plafonner le notionnel interdisait tout trade à stop serré : sur un prix de
  // 100 avec un stop à 98, risquer 1 % d'un capital de 1000 donne 500 de
  // notionnel — soit 50 % du capital pour 1 % de risque. C'est la distance au
  // stop qui mesure le danger, pas la taille de la position.
  maxRisqueMarchePct: 2,  // risque cumulé par marché, en % du capital
  maxRisqueTotalPct: 5,   // risque cumulé tous marchés, en % du capital
  // Le levier n'est qu'un garde-fou de MARGE : il ne dit pas le danger (c'est le
  // risque engagé qui le dit). Calibré sur les données : un stop à 1 ATR implique
  // mécaniquement `prix / stop × risque%` de levier — 0,8× sur R_75, 8× sur BTC,
  // et **13,7× sur l'or**. Un plafond à 10× refusait donc 270 trades sur 536,
  // presque tous de l'or. 30× laisse passer les stops serrés légitimes sans
  // autoriser l'absurde.
  maxLevier: 30,
  maxRisqueTradePct: 2    // un trade ne peut pas risquer plus que ça
};

let cache = null;
let mtime = -1;

function nombre(v, defaut) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : defaut;
}

function normaliser(brut) {
  const j = brut && typeof brut === 'object' ? brut : {};
  return {
    capital: nombre(j.capital, DEFAUT.capital),
    risquePct: nombre(j.risquePct, DEFAUT.risquePct),
    maxPerteJourPct: nombre(j.maxPerteJourPct, DEFAUT.maxPerteJourPct),
    maxSimultanes: Math.round(nombre(j.maxSimultanes, DEFAUT.maxSimultanes)),
    maxRisqueMarchePct: nombre(j.maxRisqueMarchePct, DEFAUT.maxRisqueMarchePct),
    maxRisqueTotalPct: nombre(j.maxRisqueTotalPct, DEFAUT.maxRisqueTotalPct),
    maxLevier: nombre(j.maxLevier, DEFAUT.maxLevier),
    maxRisqueTradePct: nombre(j.maxRisqueTradePct, DEFAUT.maxRisqueTradePct)
  };
}

function configuration() {
  try {
    const st = fs.statSync(FICHIER);
    if (cache && st.mtimeMs === mtime) return cache;
    cache = normaliser(JSON.parse(fs.readFileSync(FICHIER, 'utf8')));
    mtime = st.mtimeMs;
    return cache;
  } catch {
    cache = cache || normaliser(DEFAUT);
    return cache;
  }
}

function configurer(patch = {}) {
  const actuel = configuration();
  const suivant = normaliser({ ...actuel, ...patch });
  fs.mkdirSync(path.dirname(FICHIER), { recursive: true });
  const tmp = `${FICHIER}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(suivant, null, 2));
  fs.renameSync(tmp, FICHIER);
  cache = suivant;
  try { mtime = fs.statSync(FICHIER).mtimeMs; } catch { mtime = -1; }
  return suivant;
}

/**
 * Taille de position pour un risque donné.
 * @returns {null|{taille, risqueMontant, risquePct, exposition, raison}}
 */
function dimensionner(entree, stop, capital = null, risquePct = null) {
  const cfg = configuration();
  const e = Number(entree), s = Number(stop);
  // ⚠️ `Number(null)` vaut 0, pas NaN : sans ce test explicite, un appel sans
  // capital calculait une taille de ZÉRO (déjà mesuré ici, et déjà payé ailleurs
  // dans ce projet avec les objectifs null du journal).
  const cap = (capital === null || capital === undefined) || !Number.isFinite(Number(capital))
    ? cfg.capital : Number(capital);
  const pct = (risquePct === null || risquePct === undefined) || !Number.isFinite(Number(risquePct))
    ? cfg.risquePct : Number(risquePct);
  if (!Number.isFinite(e) || !Number.isFinite(s) || e <= 0) {
    return { taille: null, risqueMontant: null, risquePct: null, exposition: null, raison: 'prix d entrée invalide' };
  }
  const distance = Math.abs(e - s);
  if (!(distance > 0)) {
    return { taille: null, risqueMontant: null, risquePct: null, exposition: null, raison: 'risque nul : entrée et stop confondus' };
  }
  if (pct > cfg.maxRisqueTradePct) {
    return {
      taille: null, risqueMontant: null, risquePct: pct, exposition: null,
      raison: `risque demandé ${pct} % au-delà du plafond par trade ${cfg.maxRisqueTradePct} %`
    };
  }
  const risqueMontant = cap * pct / 100;
  const taille = risqueMontant / distance;
  return {
    taille: +taille.toFixed(8),
    risqueMontant: +risqueMontant.toFixed(2),
    risquePct: pct,
    exposition: +(taille * e).toFixed(2),
    raison: null
  };
}

/**
 * État du compte déduit du journal : courbe de capital, perte du jour,
 * positions ouvertes, exposition par marché.
 *
 * La composition est celle du journal (R par trade × risque% × capital) : c'est
 * la seule mesure honnête, puisqu'on n'a pas d'exécution réelle.
 */
function etat(signaux, options = {}) {
  const cfg = configuration();
  const capitalInitial = (options.capital === null || options.capital === undefined)
    || !Number.isFinite(Number(options.capital))
    ? cfg.capital : Number(options.capital);
  const pct = (options.risquePct === null || options.risquePct === undefined)
    || !Number.isFinite(Number(options.risquePct))
    ? cfg.risquePct : Number(options.risquePct);
  const liste = Array.isArray(signaux) ? signaux : [];

  const clos = liste.filter(s => Number.isFinite(s.r) && s.resultat !== 'ouvert')
    .slice().sort((a, b) => (a.at || 0) - (b.at || 0));
  const ouverts = liste.filter(s => s.resultat === 'ouvert');

  // Courbe composée : chaque trade risque pct % du capital COURANT.
  let capital = capitalInitial;
  let pic = capitalInitial;
  let pireDrawdown = 0;
  const courbe = [];
  for (const s of clos) {
    capital *= (1 + (s.r * pct) / 100);
    pic = Math.max(pic, capital);
    const dd = pic > 0 ? (capital - pic) / pic : 0;
    pireDrawdown = Math.min(pireDrawdown, dd);
    courbe.push({ at: s.at || null, r: s.r, capital: +capital.toFixed(2) });
  }

  // Perte du jour : celle qu'on a RÉELLEMENT subie, donc celle des trades que les
  // plafonds auraient laissé passer. Additionner tous les trades du jour
  // déclenchait le stop sur des pertes jamais encaissées (mesuré : 27,48 % avec
  // un livre vide, parce que le journal d'avant les garde-fous avait tout pris).
  const simJour = simuler(liste, { capital: capitalInitial, risquePct: pct, depuis: options.depuis });
  const rJour = simJour.rJour;
  const perteJourPct = simJour.perteJourPct;

  // Le capital de référence est celui de la SIMULATION, pas la composition
  // naïve : dimensionner sur un capital gonflé par des trades qu'on n'aurait pas
  // pris donnait des tailles trop grosses (mesuré : 21,90 de risque pour 1 % d'un
  // capital affiché 2 190, alors que le compte simulé en vaut 918).
  capital = simJour.capital;
  pic = simJour.pic;
  pireDrawdown = simJour.drawdownPct / 100;

  // Risque engagé : ce qu'on perd si TOUS les stops sont touchés. C'est le seul
  // chiffre qui mesure le danger d'un ensemble de positions — le notionnel ne
  // dit que la marge nécessaire.
  const risqueParMarche = {};
  const expositionParMarche = {};
  let risqueTotal = 0;
  let expositionTotale = 0;
  for (const s of ouverts) {
    const d = dimensionner(s.entree, s.stop, capital, pct);
    if (d.taille === null) continue;
    const cle = s.symbol || '?';
    const risque = Math.abs(Number(s.entree) - Number(s.stop)) * d.taille;
    risqueParMarche[cle] = +((risqueParMarche[cle] || 0) + risque).toFixed(2);
    expositionParMarche[cle] = +((expositionParMarche[cle] || 0) + d.exposition).toFixed(2);
    risqueTotal += risque;
    expositionTotale += d.exposition;
  }

  return {
    capitalInitial,
    capital: +capital.toFixed(2),
    gainPct: capitalInitial > 0 ? +(((capital - capitalInitial) / capitalInitial) * 100).toFixed(2) : null,
    pic: +pic.toFixed(2),
    drawdownPct: +(pireDrawdown * 100).toFixed(2),
    tradesTranches: clos.length,
    positionsOuvertes: ouverts.length,
    rJour: +rJour.toFixed(2),
    perteJourPct: +perteJourPct.toFixed(2),
    // Risque et exposition : deux choses différentes, toutes deux exposées.
    risqueEngage: +risqueTotal.toFixed(2),
    risqueEngagePct: +((risqueTotal / capital) * 100).toFixed(2),
    risqueParMarche,
    expositionTotale: +expositionTotale.toFixed(2),
    expositionParMarche,
    levier: capital > 0 ? +(expositionTotale / capital).toFixed(2) : null,
    plafonds: cfg,
    courbe: courbe.slice(-200)
  };
}

/**
 * Peut-on prendre ce trade ? Rend un refus CHIFFRÉ, jamais un simple « non ».
 * @param {{entree:number, stop:number, symbol?:string}} trade
 * @param {object} etatCourant sortie de `etat()`
 */
function verifierPrise(trade, etatCourant, options = {}) {
  const cfg = configuration();
  const e = etatCourant || etat([], options);
  const refus = [];

  const d = dimensionner(trade.entree, trade.stop, e.capital, options.risquePct);
  if (d.taille === null) refus.push(d.raison);

  if (e.perteJourPct >= cfg.maxPerteJourPct) {
    refus.push(`perte du jour ${e.perteJourPct.toFixed(2)} % pour un plafond de ${cfg.maxPerteJourPct} %`);
  }
  if (e.positionsOuvertes >= cfg.maxSimultanes) {
    refus.push(`${e.positionsOuvertes} positions ouvertes pour ${cfg.maxSimultanes} autorisées`);
  }
  const symbole = trade.symbol || '?';
  // Plafonds de RISQUE ENGAGÉ (pas de notionnel : voir la note de DEFAUT).
  const risqueMarche = (e.risqueParMarche && e.risqueParMarche[symbole]) || 0;
  const risqueApres = risqueMarche + (d.risqueMontant || 0);
  const plafondMarche = e.capital * cfg.maxRisqueMarchePct / 100;
  if (risqueApres > plafondMarche + 1e-9) {
    refus.push(`risque ${symbole} ${risqueApres.toFixed(2)} > plafond ${plafondMarche.toFixed(2)} (${cfg.maxRisqueMarchePct} % du capital)`);
  }
  const risqueTotalApres = e.risqueEngage + (d.risqueMontant || 0);
  const plafondTotal = e.capital * cfg.maxRisqueTotalPct / 100;
  if (risqueTotalApres > plafondTotal + 1e-9) {
    refus.push(`risque total ${risqueTotalApres.toFixed(2)} > plafond ${plafondTotal.toFixed(2)} (${cfg.maxRisqueTotalPct} % du capital)`);
  }
  const levierApres = e.capital > 0 ? (e.expositionTotale + (d.exposition || 0)) / e.capital : null;
  if (levierApres !== null && levierApres > cfg.maxLevier + 1e-9) {
    refus.push(`levier ${levierApres.toFixed(2)}× > plafond ${cfg.maxLevier}×`);
  }

  return {
    ok: refus.length === 0,
    refus,
    taille: d.taille,
    risqueMontant: d.risqueMontant,
    exposition: d.exposition,
    raison: refus.length ? refus.join(' · ') : null
  };
}

/**
 * SIMULATION HONNÊTE : rejouer le journal comme le COMPTE l'aurait vécu, avec
 * les plafonds appliqués à chaque prise.
 *
 * Pourquoi ce n'est pas la même chose que composer tous les R : mesuré sur le
 * journal réel, la composition naïve de 531 trades affichait **+127 %** de
 * capital. Or 29 positions étaient ouvertes en même temps pour un plafond de 5 :
 * la plupart de ces trades n'auraient jamais été pris. Un chiffre flatteur qui
 * décrit une stratégie qu'on n'a pas suivie est pire qu'aucun chiffre.
 *
 * On avance donc dans le temps : on libère les positions dont la sortie est
 * antérieure, on vérifie les plafonds, et on ne compose QUE ce qui passe.
 */
function simuler(signaux, options = {}) {
  const cfg = configuration();
  const capital0 = (options.capital === null || options.capital === undefined)
    || !Number.isFinite(Number(options.capital)) ? cfg.capital : Number(options.capital);
  const pct = (options.risquePct === null || options.risquePct === undefined)
    || !Number.isFinite(Number(options.risquePct)) ? cfg.risquePct : Number(options.risquePct);

  const trades = (Array.isArray(signaux) ? signaux : [])
    .filter(s => Number.isFinite(s.r) && s.resultat !== 'ouvert' && Number.isFinite(s.at))
    .slice().sort((a, b) => a.at - b.at);

  let capital = capital0;
  let pic = capital0;
  let pireDrawdown = 0;
  let prises = 0, refusees = 0;
  let rJour = 0;
  const debutJour = new Date();
  debutJour.setHours(0, 0, 0, 0);
  // `depuis` : instant de remise à zéro du compte papier (voir entretien.js
  // heritage). Après une remise à zéro, la perte du jour repart de zéro — sinon
  // le stop journalier bloquerait la journée entière à cause de trades qui
  // appartenaient au compte précédent.
  const depuis = Number.isFinite(Number(options.depuis)) && Number(options.depuis) > 0
    ? Number(options.depuis) : 0;
  const debutJourMs = Math.max(debutJour.getTime(), depuis);
  const raisonsRefus = {};
  const ouvertes = [];     // {sortie, risque, marche}
  const courbe = [];

  for (const t of trades) {
    // 1. Libérer ce qui s'est clôturé avant cette entrée.
    for (let i = ouvertes.length - 1; i >= 0; i--) {
      if (ouvertes[i].sortie <= t.at) ouvertes.splice(i, 1);
    }
    // 2. État à cet instant, calculé sur les positions encore ouvertes.
    const risqueParMarche = {};
    const expositionParMarche = {};
    let risqueEngage = 0, expositionTotale = 0;
    for (const p of ouvertes) {
      risqueParMarche[p.marche] = (risqueParMarche[p.marche] || 0) + p.risque;
      expositionParMarche[p.marche] = (expositionParMarche[p.marche] || 0) + p.exposition;
      risqueEngage += p.risque;
      expositionTotale += p.exposition;
    }
    const instantane = {
      capital, positionsOuvertes: ouvertes.length, risqueEngage, risqueParMarche,
      expositionTotale, expositionParMarche, perteJourPct: 0
    };
    // 3. Vérifier les plafonds.
    const verdict = verifierPrise(
      { entree: t.entree, stop: t.stop, symbol: t.symbol },
      instantane, { capital, risquePct: pct }
    );
    if (!verdict.ok) {
      refusees++;
      const motif = (verdict.refus && verdict.refus[0]) || 'refusé';
      const cle = /positions ouvertes/.test(motif) ? 'positions simultanées'
        : /risque .* plafond/.test(motif) ? 'risque par marché'
        : /risque total/.test(motif) ? 'risque total'
        : /levier/.test(motif) ? 'levier'
        : /perte du jour/.test(motif) ? 'perte journalière' : 'autre';
      raisonsRefus[cle] = (raisonsRefus[cle] || 0) + 1;
      continue;
    }
    // 4. Prise : on compose et on mémorise l'occupation.
    const horizon = (t.leveLe && t.leveLe > t.at) ? t.leveLe : t.at + 60 * 5 * 60 * 1000;
    ouvertes.push({
      sortie: horizon,
      risque: verdict.risqueMontant || 0,
      exposition: verdict.exposition || 0,
      marche: t.symbol || '?'
    });
    capital *= (1 + (t.r * pct) / 100);
    pic = Math.max(pic, capital);
    if (pic > 0) pireDrawdown = Math.min(pireDrawdown, (capital - pic) / pic);
    prises++;
    // La perte du jour ne compte QUE les trades que le compte a réellement pris.
    // Sinon le stop journalier se déclenche sur des pertes qu'on n'a pas subies.
    if ((t.leveLe || t.at) >= debutJourMs) rJour += t.r;
    courbe.push({ at: t.at, r: t.r, capital: +capital.toFixed(2) });
  }

  return {
    capitalInitial: capital0,
    capital: +capital.toFixed(2),
    gainPct: capital0 > 0 ? +(((capital - capital0) / capital0) * 100).toFixed(2) : null,
    pic: +pic.toFixed(2),
    drawdownPct: +(pireDrawdown * 100).toFixed(2),
    tradesJournal: trades.length,
    prises,
    refusees,
    tauxPrise: trades.length ? +((prises / trades.length) * 100).toFixed(1) : null,
    raisonsRefus,
    risquePct: pct,
    // Perte du jour RÉELLEMENT subie (trades pris seulement) : c'est elle qui
    // doit arrêter la journée, pas la somme de tout ce qui a été détecté.
    rJour: +rJour.toFixed(2),
    perteJourPct: +(-(rJour * pct)).toFixed(2),
    plafonds: cfg,
    courbe: courbe.slice(-200),
    // Comparaison : ce que donnerait la composition naïve (sans plafonds).
    naif: (() => {
      let c = capital0;
      for (const t of trades) c *= (1 + (t.r * pct) / 100);
      return {
        capital: +c.toFixed(2),
        gainPct: capital0 > 0 ? +(((c - capital0) / capital0) * 100).toFixed(2) : null,
        avertissement: 'compose TOUS les trades, y compris ceux que les plafonds auraient refusés'
      };
    })()
  };
}

module.exports = {
  FICHIER, DEFAUT, configuration, configurer, dimensionner, etat, verifierPrise, simuler, normaliser
};
