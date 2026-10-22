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
  maxLevier: 10,          // notionnel total / capital (garde-fou de marge)
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

  // Perte du jour : somme des R des trades tranchés aujourd'hui.
  const debutJour = new Date();
  debutJour.setHours(0, 0, 0, 0);
  const rJour = clos
    .filter(s => (s.leveLe || s.at || 0) >= debutJour.getTime())
    .reduce((a, s) => a + s.r, 0);
  const perteJourPct = -(rJour * pct);

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

module.exports = {
  FICHIER, DEFAUT, configuration, configurer, dimensionner, etat, verifierPrise, normaliser
};
