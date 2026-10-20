/**
 * 5trade — JOURNAL DES SIGNAUX.
 *
 * Le problème résolu : un signal s'affichait, puis disparaissait. Personne ne
 * savait s'il avait atteint son objectif, touché son invalidation, ou fini au
 * point d'entrée. Sans trace du RÉSULTAT, une liste de signaux n'est qu'une
 * opinion : impossible de dire si le moteur a raison, ni quelle stratégie marche.
 *
 * Ici chaque signal émis est PERSISTÉ avec ses niveaux, puis RÉÉVALUÉ sur les
 * bougies suivantes. L'issue est enregistrée : objectif 1, objectif 2, stop,
 * retour au point d'entrée (BE), ou expiration.
 *
 * Règle de lecture (assumée, écrite noir sur blanc) : si le stop et un objectif
 * sont touchés sur la MÊME bougie, on retient le STOP. C'est le cas défavorable.
 * Compter l'objectif reviendrait à s'attribuer un gain que le prix n'a peut-être
 * jamais laissé prendre.
 */

const fs = require('fs');
const path = require('path');

const FICHIER = process.env.JOURNAL_SIGNAUX_FICHIER
  || path.join(__dirname, '..', 'data', 'signaux-journal.json');
const MAX_ENTREES = 800;        // au-delà, on jette les plus anciennes
const MAX_BOUGIES_SUIVI = 60;   // au-delà, le signal est « expiré »

// ─── Stockage ────────────────────────────────────────────────────────────
// Écriture atomique (même raison que db.js) : un process tué en pleine écriture
// ne doit pas laisser un JSON tronqué, sinon tout le journal est perdu.
function charger() {
  try {
    const d = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
    if (d && Array.isArray(d.signaux)) return d;
  } catch { /* fichier absent ou illisible : on repart proprement */ }
  return { version: 1, signaux: [] };
}

function sauver(data) {
  fs.mkdirSync(path.dirname(FICHIER), { recursive: true });
  const tmp = `${FICHIER}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FICHIER);
}

// ─── Enregistrement ──────────────────────────────────────────────────────
/**
 * Persiste les signaux qui ont des niveaux exploitables.
 * On n'enregistre PAS les signaux sans entrée/stop : sans niveaux, il n'y a
 * rien à évaluer plus tard, et le journal se remplirait de lignes invérifiables.
 *
 * @returns {{ajoutes:number, ignores:number}}
 */
function enregistrer(signaux, meta = {}, options = {}) {
  const data = charger();
  const existants = new Set(data.signaux.map(s => s.cle));
  let ajoutes = 0, ignores = 0;

  for (const s of signaux || []) {
    // ATTENTION : `Number(null)` vaut 0, pas NaN. Un signal sans niveaux (un
    // amas de stops, un extrême de range) passait donc le contrôle avec
    // entrée = 0 et stop = 0, et polluait le journal avec une ligne invérifiable.
    if (s.entree === null || s.entree === undefined || s.stop === null || s.stop === undefined) { ignores++; continue; }
    const e = Number(s.entree), st = Number(s.stop);
    const objs = (s.objectifs || [])
      .filter(o => o !== null && o !== undefined)
      .map(Number).filter(Number.isFinite);
    if (!Number.isFinite(e) || !Number.isFinite(st) || e === 0 || st === 0 || !objs.length) { ignores++; continue; }
    if (!s.sens || s.sens === 'neutre') { ignores++; continue; }

    // Identité du signal : symbole + unité + détecteur + sens. C'est elle qui
    // décide si on a déjà une ligne VIVANTE pour ce signal.
    //
    // Avant, la clé contenait l'horodatage de la bougie : un signal qui restait
    // « à surveiller » pendant dix bougies créait DIX lignes, toutes encore
    // ouvertes, et le journal se remplissait du même signal répété — jusqu'à
    // saturer les 800 entrées et jeter l'historique utile.
    const identite = `${meta.symbol}|${meta.timeframe}|${s.id}|${s.sens}`;
    const dejaVivante = data.signaux.some(x =>
      (x.identite || String(x.cle || '').split('|').slice(0, 4).join('|')) === identite
      && x.resultat === 'ouvert');
    if (dejaVivante) { ignores++; continue; }

    // Clé d'occurrence : l'identité + la bougie. Deux occurrences du MÊME signal
    // restent donc distinctes une fois la première tranchée.
    const cle = `${identite}|${s.at || meta.at || ''}`;
    if (existants.has(cle)) { ignores++; continue; }

    data.signaux.push({
      cle,
      identite,
      at: s.at || meta.at || Date.now(),
      enregistreAt: Date.now(),
      symbol: meta.symbol || null,
      timeframe: meta.timeframe || null,
      provider: meta.provider || null,
      source: s.source,
      id: s.id,
      nom: s.nom,
      strategie: s.strategie || null,
      concept: s.concept || null,
      sens: s.sens,
      force: s.force,
      conditions: (s.conditions || []).length,
      conditionsOk: (s.conditions || []).filter(c => c.ok).length,
      structure: s.structureContexte ? {
        alignement: s.structureContexte.alignement,
        position: s.structureContexte.position,
        ajustement: s.structureContexte.ajustement
      } : null,
      entree: e,
      stop: st,
      objectifs: objs,
      rr: s.rr,
      // Suivi
      resultat: 'ouvert',
      leveLe: null,
      bougiesSuivies: 0,
      atteintTP1: false,
      atteintTP2: false,
      toucheSL: false,
      retourEntree: false,
      extremumFavorable: null,
      extremumDefavorable: null,
      r: null
    });
    existants.add(cle);
    ajoutes++;
  }

  if (ajoutes) {
    if (data.signaux.length > MAX_ENTREES) {
      data.signaux = data.signaux.slice(-MAX_ENTREES);
    }
    sauver(data);
  }
  return { ajoutes, ignores };
}

// ─── Évaluation ──────────────────────────────────────────────────────────
/**
 * Évalue UN signal sur les bougies postérieures à son émission.
 * Parcourt les bougies dans l'ordre chronologique : le premier événement gagne.
 */
function evaluer(sig, bougies) {
  const apres = (bougies || [])
    .filter(c => c && c.t > sig.at && c.closed !== false)
    .sort((a, b) => a.t - b.t);
  if (!apres.length) return sig;

  // Initialisation défensive : un signal peut arriver ici sans avoir transité par
  // `enregistrer` (test, reprise d'un ancien fichier). Sans ces valeurs,
  // `bougiesSuivies++` valait NaN et la boucle ne s'arrêtait jamais.
  sig.resultat = sig.resultat || 'ouvert';
  sig.bougiesSuivies = Number(sig.bougiesSuivies) || 0;
  sig.atteintTP1 = !!sig.atteintTP1;
  sig.atteintTP2 = !!sig.atteintTP2;
  sig.toucheSL = !!sig.toucheSL;
  sig.retourEntree = !!sig.retourEntree;

  // On ne réévalue pas un signal déjà tranché.
  if (sig.resultat !== 'ouvert') return sig;

  const long = sig.sens === 'long';
  const stop = sig.stop;
  const tp1 = sig.objectifs[0];
  const tp2 = sig.objectifs[1];
  let maxFav = null, maxDef = null;
  // Bougie où TP1 a été touché : le retour à l'entrée ne peut être constaté
  // qu'APRÈS. Le tester sur la bougie du TP1 était faux — cette bougie part
  // souvent de l'entrée, donc son extrême défavorable touche le point d'entrée
  // par construction et le signal était classé « BE » alors qu'il venait
  // d'atteindre son objectif.
  let tp1At = null;

  for (const c of apres) {
    sig.bougiesSuivies++;

    const fav = long ? c.h : c.l;
    const def = long ? c.l : c.h;
    maxFav = maxFav === null ? fav : (long ? Math.max(maxFav, fav) : Math.min(maxFav, fav));
    maxDef = maxDef === null ? def : (long ? Math.min(maxDef, def) : Math.max(maxDef, def));

    // 1. Le stop d'abord : sur une même bougie, on retient le cas défavorable.
    if (long ? c.l <= stop : c.h >= stop) {
      sig.toucheSL = true;
      // Stop atteint alors que TP1 était déjà pris : le trade avait été protégé,
      // il ressort au point d'entrée (BE), pas en perte pleine.
      sig.resultat = sig.atteintTP1 ? 'be' : 'sl';
      sig.leveLe = c.t;
      break;
    }

    // 2. Objectifs sur cette bougie (TP2 d'abord si TP1 déjà acquis).
    const touche1 = Number.isFinite(tp1) && (long ? c.h >= tp1 : c.l <= tp1);
    if (!sig.atteintTP1 && touche1) {
      sig.atteintTP1 = true;
      tp1At = c.t;
    }
    if (sig.atteintTP1 && Number.isFinite(tp2) && (long ? c.h >= tp2 : c.l <= tp2)) {
      sig.atteintTP2 = true;
      sig.resultat = 'tp2';
      sig.leveLe = c.t;
      break;
    }

    // 3. Retour au point d'entrée APRÈS la bougie du TP1 : trade protégé (BE).
    if (sig.atteintTP1 && tp1At !== null && c.t > tp1At
      && (long ? c.l <= sig.entree : c.h >= sig.entree)) {
      sig.retourEntree = true;
      sig.resultat = 'be';
      sig.leveLe = c.t;
      break;
    }

    // 4. Trop vieux : on arrête de suivre. Si l'objectif 1 était acquis, le
    // signal reste une réussite (il n'a simplement pas été jusqu'à TP2).
    if (sig.bougiesSuivies >= MAX_BOUGIES_SUIVI) {
      sig.resultat = sig.atteintTP1 ? 'tp1' : 'expire';
      sig.leveLe = c.t;
      break;
    }
  }

  sig.extremumFavorable = maxFav;
  sig.extremumDefavorable = maxDef;
  sig.r = multipleR(sig);
  return sig;
}

/** Gain/perte en « R » (risque initial = 1). */
function multipleR(sig) {
  const risque = Math.abs(sig.entree - sig.stop);
  if (!risque) return null;
  switch (sig.resultat) {
    case 'tp2': {
      const o = sig.objectifs[1];
      return Number.isFinite(o) ? +(((sig.sens === 'long' ? o - sig.entree : sig.entree - o) / risque).toFixed(2)) : null;
    }
    case 'tp1': {
      const o = sig.objectifs[0];
      return Number.isFinite(o) ? +(((sig.sens === 'long' ? o - sig.entree : sig.entree - o) / risque).toFixed(2)) : null;
    }
    // BE : objectif 1 pris, puis retour à l'entrée. On compte la moitié du
    // premier objectif — c'est ce qu'un gestionnaire sérieux sécurise.
    case 'be': {
      const o = sig.objectifs[0];
      return Number.isFinite(o) ? +((((sig.sens === 'long' ? o - sig.entree : sig.entree - o) / risque) / 2).toFixed(2)) : 0;
    }
    case 'sl': return -1;
    case 'expire': return 0;
    default: return null;
  }
}

/**
 * Met à jour les signaux encore ouverts.
 * @param {Function} getBougies async (symbol, tf, provider) => candles
 */
async function mettreAJour(getBougies, options = {}) {
  const data = charger();
  const ouverts = data.signaux.filter(s => s.resultat === 'ouvert');
  if (!ouverts.length) return { maj: 0, restants: 0 };

  // Regroupe par (symbol, tf, provider) pour ne charger chaque série qu'UNE fois.
  const groupes = new Map();
  for (const s of ouverts) {
    const k = `${s.symbol}|${s.timeframe}|${s.provider || ''}`;
    if (!groupes.has(k)) groupes.set(k, []);
    groupes.get(k).push(s);
  }

  let maj = 0;
  for (const [k, liste] of groupes) {
    const [symbol, timeframe, provider] = k.split('|');
    let bougies = null;
    try {
      const r = await getBougies(symbol, timeframe, provider || undefined);
      bougies = (r && r.candles) || r || [];
    } catch { continue; }   // une série indisponible ne bloque pas les autres
    if (!Array.isArray(bougies) || !bougies.length) continue;
    for (const s of liste) {
      const avant = s.resultat;
      evaluer(s, bougies);
      if (s.resultat !== avant) maj++;
    }
  }

  if (maj) {
    data.majLe = Date.now();
    sauver(data);
  }
  return { maj, restants: data.signaux.filter(s => s.resultat === 'ouvert').length };
}

// ─── Lecture et statistiques ─────────────────────────────────────────────
function lister({ symbol, resultat, source, limite = 100 } = {}) {
  const data = charger();
  let l = data.signaux;
  if (symbol) l = l.filter(s => s.symbol === symbol);
  if (resultat) l = l.filter(s => s.resultat === resultat);
  if (source) l = l.filter(s => s.source === source);
  return l.slice(-limite).reverse();
}

const CLOS = new Set(['tp1', 'tp2', 'be', 'sl', 'expire']);

function stats() {
  const data = charger();
  const tous = data.signaux;
  const clos = tous.filter(s => CLOS.has(s.resultat));

  const compte = (arr, cle) => {
    const m = {};
    for (const s of arr) {
      const k = typeof cle === 'function' ? cle(s) : s[cle];
      if (k === null || k === undefined || k === '') continue;
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  };

  // Un « gagné » = objectif touché (tp1, tp2) ou trade protégé (be). Un « perdu »
  // = stop. Les expirations ne sont ni l'un ni l'autre : elles sont comptées à
  // part, sinon un moteur qui ne se déclenche jamais aurait 0 % de pertes.
  const gagnes = clos.filter(s => s.resultat === 'tp1' || s.resultat === 'tp2' || s.resultat === 'be');
  const perdus = clos.filter(s => s.resultat === 'sl');
  const decides = gagnes.length + perdus.length;
  const rTotal = clos.reduce((a, s) => a + (Number.isFinite(s.r) ? s.r : 0), 0);

  const parStrategie = {};
  for (const s of clos) {
    const k = s.strategie || (s.source === 'motif' ? `motif : ${s.nom}` : s.source === 'structure' ? 'structure du marché' : s.nom);
    if (!parStrategie[k]) parStrategie[k] = { total: 0, gagnes: 0, perdus: 0, be: 0, r: 0 };
    const p = parStrategie[k];
    p.total++;
    p.r += Number.isFinite(s.r) ? s.r : 0;
    if (s.resultat === 'sl') p.perdus++;
    else if (s.resultat === 'be') p.be++;
    else p.gagnes++;
  }

  return {
    total: tous.length,
    ouverts: tous.filter(s => s.resultat === 'ouvert').length,
    clos: clos.length,
    parResultat: compte(tous, 'resultat'),
    gagnes: gagnes.length,
    perdus: perdus.length,
    expires: clos.filter(s => s.resultat === 'expire').length,
    // Taux de réussite calculé sur les trades DÉCIDÉS (gain ou perte), pas sur
    // les expirations : mélanger les deux rendrait le chiffre flatteur à tort.
    tauxReussite: decides ? +((gagnes.length / decides) * 100).toFixed(1) : null,
    rTotal: +rTotal.toFixed(2),
    rMoyen: clos.length ? +(rTotal / clos.length).toFixed(2) : null,
    parSens: compte(clos, 'sens'),
    parSource: compte(clos, s => s.source),
    parMarche: compte(clos, s => `${s.symbol} ${s.timeframe}`),
    parStrategie,
    derniereMaj: data.majLe || null
  };
}

module.exports = {
  FICHIER, enregistrer, evaluer, mettreAJour, lister, stats, charger, sauver,
  MAX_BOUGIES_SUIVI
};
