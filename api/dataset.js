/**
 * 5trade — JEU DE DONNÉES.
 *
 * Le problème résolu : le journal ne garde que TROIS attributs structurels et
 * un COMPTE de conditions (`conditions: 8`). Le moteur mesure pourtant ~45
 * éléments par graphique (BOS, FVG, order blocks, sweeps, premium/discount,
 * ATR, sessions, distances en ATR…). Tout cela était jeté au moment d'écrire la
 * ligne : impossible d'apprendre quoi que ce soit là-dessus, puisque la matière
 * première n'existait plus.
 *
 * Ici on rejoue le moteur sur un historique LONG et on écrit, pour chaque
 * signal : le VECTEUR DE FEATURES COMPLET tel qu'il était mesurable à cet
 * instant, et l'ISSUE du trade. Une ligne = un trade = features + étiquette.
 *
 * Trois garanties, dans l'ordre d'importance :
 *
 *  1. AUCUNE FUITE DU FUTUR. À l'étape i, `detecterTout` ne reçoit que
 *     `bougies[0..i]` (bougies clôturées). L'issue est jugée sur `i+1..n` par
 *     `Journal.evaluer` — la MÊME fonction que le direct, donc les mêmes
 *     conventions (stop prioritaire, BE après objectif 1).
 *
 *  2. UN SIGNAL QUI PERSISTE NE CRÉE PAS N TRADES. `resolues` mémorise l'index
 *     de clôture de chaque occurrence : la même configuration ne compte pas
 *     dix fois. Sans ça, l'échantillon est gonflé par les signaux qui traînent.
 *
 *  3. `index` EST CONSERVÉ SUR CHAQUE LIGNE. C'est ce qui permettra, à
 *     l'entraînement, de purger les fenêtres qui se chevauchent (un trade qui
 *     dure 60 bougies partage son futur avec les suivants). Sans cette colonne,
 *     la validation walk-forward est impossible à faire proprement.
 *
 * Coût IA : zéro. Tout est local.
 */

const fs = require('fs');
const path = require('path');
const Multi = require('./signaux');
const Journal = require('./journal-signaux');
const Historique = require('./historique');

const DOSSIER = process.env.DATASET_DOSSIER
  || path.join(__dirname, '..', 'data', 'dataset');

const FENETRE_MIN = 120;      // bougies d'échauffement avant de juger
const PAS_DEFAUT = 2;         // on n'évalue pas chaque bougie (coût inutile)

function nomFichier(provider, symbol, tf) {
  const propre = s => String(s).replace(/[^A-Za-z0-9_.-]/g, '_');
  return path.join(DOSSIER, `${propre(provider)}-${propre(symbol)}-${propre(tf)}.jsonl`);
}

/**
 * Le vecteur de features d'un signal — écrit tel qu'il est, sans arrondi
 * cosmétique. Ce qui n'a pas été mesuré reste null : une colonne vide est une
 * information (« le moteur ne savait pas »), une colonne inventée est un poison.
 */
function features(s, carte) {
  return {
    force: Number.isFinite(s.force) ? s.force : null,
    forceAvant: s.forceDetail ? s.forceDetail.avant : null,
    ajustement: s.forceDetail ? s.forceDetail.ajustement : null,
    plafonnee: s.forceDetail ? !!s.forceDetail.plafonnee : null,
    // Toutes les conditions avec LEUR VALEUR mesurée et LEUR SEUIL, pas
    // seulement leur nombre. La forme réelle d'une condition est
    // {nom, valeur, seuil, ok} — pas {libelle, ...} : vérifié sur une sortie
    // réelle de detecterTout avant d'écrire cette ligne.
    conditions: (s.conditions || []).map(c => ({
      nom: c.nom !== undefined ? c.nom : c.libelle,
      valeur: c.valeur !== undefined ? c.valeur : null,
      seuil: c.seuil !== undefined ? c.seuil : null,
      ok: !!c.ok
    })),
    conditionsOk: (s.conditions || []).filter(c => c.ok).length,
    structure: s.structureContexte ? {
      alignement: s.structureContexte.alignement,
      position: s.structureContexte.position,
      ajustement: s.structureContexte.ajustement,
      favorables: s.structureContexte.favorables,
      defavorables: s.structureContexte.defavorables,
      // `zone` est un LIBELLÉ (« FVG bearish »), pas un objet avec une distance.
      zone: s.structureContexte.zone || null,
      lecture: s.structureContexte.lecture || null
    } : null,
    // La carte de marché a ses propres noms de champs : tendance / atr / prix /
    // session. Les deviner (« trend », « atr14 », « lastPrice ») produisait une
    // colonne entièrement nulle alors que la donnée existait.
    carte: carte ? {
      tendance: carte.tendance || null,
      // `position` est un OBJET {zone, equilibre, bas, haut, ote}, pas une
      // chaîne : on extrait la zone, sinon la colonne contient un objet entier.
      positionZone: carte.position
        ? (typeof carte.position === 'string' ? carte.position : (carte.position.zone || null))
        : null,
      atr: Number.isFinite(carte.atr) ? carte.atr : null,
      prix: Number.isFinite(carte.prix) ? carte.prix : null,
      // `session` est un OBJET {courante, killZone}.
      session: carte.session
        ? (typeof carte.session === 'string' ? carte.session : (carte.session.courante || null))
        : null,
      killZone: carte.session && typeof carte.session === 'object' ? (carte.session.killZone || null) : null,
      zones: Array.isArray(carte.zones) ? carte.zones.length : null,
      liquidites: Array.isArray(carte.liquidite) ? carte.liquidite.length : null,
      balayages: Array.isArray(carte.balayages) ? carte.balayages.length : null,
      deplacements: Array.isArray(carte.deplacements) ? carte.deplacements.length : null,
      zoneProche: carte.zoneLaPlusProche ? (carte.zoneLaPlusProche.type || null) : null,
      evenement: carte.evenement ? (carte.evenement.type || null) : null
    } : null,
    niveaux: {
      entree: s.entree,
      stop: s.stop,
      objectifs: s.objectifs,
      rr: Number.isFinite(s.rr) ? s.rr : null,
      risque: Math.abs(Number(s.entree) - Number(s.stop)),
      risquePctPrix: Number(s.entree)
        ? +((Math.abs(Number(s.entree) - Number(s.stop)) / Number(s.entree)) * 100).toFixed(4)
        : null
    }
  };
}

/**
 * Rejoue l'historique et rend les lignes. N'écrit rien : l'appelant décide.
 * @returns {Array<object>}
 */
function generer({ bougies, symbol, tf, provider = null, profils = [], pas = PAS_DEFAUT, maxBougies = null }) {
  const serie = (bougies || [])
    .filter(c => c && Number.isFinite(c.t) && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c))
    .sort((a, b) => a.t - b.t);
  const n = serie.length;
  if (n < FENETRE_MIN + 10) return [];

  const saut = Math.max(1, Math.round(Number(pas) || PAS_DEFAUT));
  const limite = Number.isFinite(maxBougies) && maxBougies > 0 ? Math.min(maxBougies, n) : n;
  const debut = Math.max(FENETRE_MIN, n - limite);

  const lignes = [];
  const resolues = new Map();     // identite -> index de résolution
  const meta = { symbol, timeframe: tf, provider };

  for (let i = debut; i < n - 1; i += saut) {
    const fenetre = serie.slice(0, i + 1);
    let r;
    try { r = Multi.detecterTout(fenetre, meta, { profils }); }
    catch { continue; }           // une fenêtre qui échoue ne doit pas arrêter le reste

    const futurs = serie.slice(i + 1);
    for (const s of r.signaux) {
      if (s.status !== 'confirme' && s.status !== 'surveiller') continue;
      // Un signal sans niveaux (ou refusé par le plafond de coût) n'est pas un trade.
      if (!Number.isFinite(Number(s.entree)) || !Number.isFinite(Number(s.stop))) continue;
      if (!Array.isArray(s.objectifs) || !s.objectifs.length) continue;
      if (!s.sens || s.sens === 'neutre') continue;

      const identite = `${s.id}|${s.sens}`;
      const deja = resolues.get(identite);
      if (deja !== undefined && deja > i) continue;   // encore ouverte : on ne recompte pas

      const trade = {
        at: serie[i].t,
        index: i,
        identite, id: s.id, nom: s.nom, source: s.source, sens: s.sens,
        strategie: s.strategie || null, concept: s.concept || null,
        entree: Number(s.entree), stop: Number(s.stop),
        objectifs: s.objectifs.map(Number).filter(Number.isFinite),
        resultat: 'ouvert',
        atteintTP1: false, atteintTP2: false, toucheSL: false, retourEntree: false,
        bougiesSuivies: 0
      };
      Journal.evaluer(trade, futurs);

      // Le trade reste « ouvert » s'il n'a rien touché dans la fenêtre : on ne
      // l'écrit pas, une étiquette inconnue n'apprend rien.
      if (trade.resultat === 'ouvert') continue;

      lignes.push({
        symbol, tf, provider,
        at: trade.at, index: i,
        id: s.id, nom: s.nom, source: s.source, strategie: trade.strategie,
        concept: trade.concept, sens: trade.sens, status: s.status,
        ...features(s, r.carte),
        issue: {
          resultat: trade.resultat,
          r: trade.r,
          rBrut: trade.rBrut,
          cout: trade.cout ? trade.cout.enR : 0,
          bougiesSuivies: trade.bougiesSuivies,
          atteintTP1: trade.atteintTP1,
          atteintTP2: trade.atteintTP2,
          toucheSL: trade.toucheSL,
          retourEntree: trade.retourEntree
        },
        // Étiquette binaire pour la classification : le trade a-t-il atteint un
        // objectif (tp1/tp2) ? Le BE et l'expiration ne sont ni l'un ni l'autre.
        gagne: trade.resultat === 'tp1' || trade.resultat === 'tp2'
      });

      const idxFin = trade.leveLe
        ? Math.max(i, serie.findIndex(c => c.t === trade.leveLe))
        : n - 1;
      resolues.set(identite, idxFin);
    }
  }

  return lignes;
}

/** Écrit les lignes en JSONL (atomique) et rend le résumé. */
function ecrire(lignes, { provider, symbol, tf }) {
  fs.mkdirSync(DOSSIER, { recursive: true });
  const fichier = nomFichier(provider, symbol, tf);
  const tmp = `${fichier}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, lignes.map(l => JSON.stringify(l)).join('\n') + (lignes.length ? '\n' : ''));
  fs.renameSync(tmp, fichier);
  return { fichier, ...resume(lignes) };
}

const CLOS = new Set(['tp1', 'tp2', 'be', 'sl', 'expire']);

/** Ce que le jeu de données contient réellement — et ce qu'il ne contient pas. */
function resume(lignes) {
  const clos = (lignes || []).filter(l => CLOS.has(l.issue && l.issue.resultat));
  const gagnes = clos.filter(l => l.issue.resultat === 'tp1' || l.issue.resultat === 'tp2');
  const perdus = clos.filter(l => l.issue.resultat === 'sl');
  const decides = gagnes.length + perdus.length;
  const rTotal = clos.reduce((a, l) => a + (Number.isFinite(l.issue.r) ? l.issue.r : 0), 0);
  const rBrutTotal = clos.reduce((a, l) => a + (Number.isFinite(l.issue.rBrut) ? l.issue.rBrut : 0), 0);
  const colonnes = new Set();
  let totalConditions = 0;
  for (const l of clos.slice(0, 500)) {
    totalConditions += (l.conditions || []).length;
    for (const c of (l.conditions || [])) colonnes.add(c.nom);
  }
  return {
    lignes: (lignes || []).length,
    tranches: clos.length,
    gagnes: gagnes.length,
    perdus: perdus.length,
    be: clos.filter(l => l.issue.resultat === 'be').length,
    expires: clos.filter(l => l.issue.resultat === 'expire').length,
    tauxReussite: decides ? +((gagnes.length / decides) * 100).toFixed(1) : null,
    esperance: clos.length ? +(rTotal / clos.length).toFixed(3) : null,
    esperanceBrute: clos.length ? +(rBrutTotal / clos.length).toFixed(3) : null,
    // Nombre de features CONDITIONNELLES distinctes, et nombre moyen de
    // conditions par trade : c'est la largeur réelle du tableau, celle qui
    // n'existait pas quand on n'écrivait que « conditions: 8 ».
    featuresConditionnelles: colonnes.size,
    conditionsParTrade: clos.length ? +(totalConditions / Math.min(clos.length, 500)).toFixed(1) : null,
    libellesConditions: [...colonnes].slice(0, 40),
    parMarche: [...new Set((lignes || []).map(l => `${l.symbol} ${l.tf}`))],
    parSource: (lignes || []).reduce((a, l) => { a[l.source] = (a[l.source] || 0) + 1; return a; }, {}),
    debuat: (lignes || []).length ? Math.min(...lignes.map(l => l.at)) : null,
    finAt: (lignes || []).length ? Math.max(...lignes.map(l => l.at)) : null
  };
}

/** Tout en un : lit l'historique stocké, génère, écrit, résume. */
function construire({ provider, symbol, tf = '5m', pas = PAS_DEFAUT, maxBougies = null, profils = [] }) {
  const src = Historique.sourcePour(symbol, provider);
  const bougies = Historique.charger(src, symbol, tf);
  if (!bougies.length) {
    throw new Error(`Aucun historique pour ${symbol} ${tf} (${src}). Lancez : node historique.js ${symbol} ${tf} 8000`);
  }
  const lignes = generer({ bougies, symbol, tf, provider: src, profils, pas, maxBougies });
  const r = ecrire(lignes, { provider: src, symbol, tf });
  return { ...r, bougies: bougies.length };
}

module.exports = {
  DOSSIER, nomFichier, generer, ecrire, resume, construire, features, FENETRE_MIN
};

// ─── Ligne de commande : node dataset.js R_75 5m 8000 2 ──────────────────
if (require.main === module) {
  const [symbol, tf = '5m', maxBougies = '', pas = ''] = process.argv.slice(2);
  if (!symbol) {
    console.log('usage : node dataset.js <symbole> [tf] [maxBougies] [pas]');
    process.exit(1);
  }
  try {
    const t0 = Date.now();
    const r = construire({
      symbol, tf,
      maxBougies: maxBougies ? Number(maxBougies) : null,
      pas: pas ? Number(pas) : PAS_DEFAUT
    });
    console.log(JSON.stringify({ ...r, ms: Date.now() - t0 }, null, 2));
  } catch (e) {
    console.error('ERREUR :', e.message);
    process.exit(1);
  }
}
