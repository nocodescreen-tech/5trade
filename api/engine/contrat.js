/**
 * 5trade — CONTRAT DE SORTIE COMMUN aux moteurs de signaux.
 *
 * Le dépôt a deux moteurs spécialisés, et c'est voulu :
 *   • `signals.js`  — verdict unique par règles SMC (R1–R8) ;
 *   • `signaux.js`  — un signal par stratégie, par motif, par fait de structure.
 *
 * Ce qui n'était pas voulu : ils parlaient deux dialectes. Un consommateur
 * (écran, alertes, journal, backtest) devait connaître les deux pour lire l'un
 * ou l'autre, et rien ne garantissait qu'un signal publié portait bien ses
 * niveaux, son sens et son statut.
 *
 * Ce module ne FUSIONNE rien : il impose une forme unique et la vérifie.
 *   `validerSignal()`   → le signal est-il complet et cohérent ?
 *   `normaliserSignal()`→ même forme, valeurs neutres ajoutées, aucun chiffre inventé
 *   `versContrat()`     → le verdict du direct exprimé dans la MÊME forme
 *
 * Un signal hors contrat n'est jamais supprimé : il reste visible avec sa raison,
 * et il n'est jamais exécutable.
 */

const CONTRAT = {
  version: 1,
  sources: ['strategie', 'motif', 'structure', 'verdict', 'scan'],
  statuts: ['confirme', 'surveiller', 'rejete', 'refuse', 'erreur'],
  // 'inconnu' est DISTINCT de 'neutre'. « Aucun avantage directionnel établi »
  // et « la stratégie n'a pas déterminé sa direction » ne sont pas la même
  // chose : le premier autorise une observation, le second interdit l'exécution.
  sens: ['long', 'short', 'neutre', 'inconnu'],
  directions: ['BUY', 'SELL', 'NEUTRAL', 'UNKNOWN'],
  // Présents dans TOUS les signaux, quelle que soit la source.
  champs: ['id', 'source', 'nom', 'tf', 'sens', 'status', 'force',
    'conditions', 'preuves', 'entree', 'stop', 'objectifs', 'rr']
};

const estNombre = v => typeof v === 'number' && Number.isFinite(v);
const estTableau = v => Array.isArray(v);

/**
 * Vérifie un signal contre le contrat.
 * @returns {{ok:boolean, manquants:string[], invalides:string[]}}
 */
function validerSignal(s) {
  const manquants = [];
  const invalides = [];
  const c = s && typeof s === 'object' ? s : {};
  const present = k => Object.prototype.hasOwnProperty.call(c, k) && c[k] !== undefined;

  for (const k of CONTRAT.champs) if (!present(k)) manquants.push(k);

  if (present('source') && !CONTRAT.sources.includes(c.source)) {
    invalides.push(`source « ${c.source} » hors contrat`);
  }
  if (present('status') && !CONTRAT.statuts.includes(c.status)) {
    invalides.push(`statut « ${c.status} » hors contrat`);
  }
  if (present('sens') && !CONTRAT.sens.includes(c.sens)) {
    invalides.push(`sens « ${c.sens} » hors contrat`);
  }
  if (present('force') && !(estNombre(c.force) && c.force >= 0 && c.force <= 1)) {
    invalides.push(`force ${JSON.stringify(c.force)} : attendu un nombre entre 0 et 1`);
  }
  if (present('conditions') && !estTableau(c.conditions)) invalides.push('conditions : attendu un tableau');
  if (present('preuves') && !estTableau(c.preuves)) invalides.push('preuves : attendu un tableau');
  if (present('objectifs') && !estTableau(c.objectifs)) invalides.push('objectifs : attendu un tableau');

  // ── Cohérence des niveaux ────────────────────────────────────────────────
  // C'est l'intégration que l'audit demandait de vérifier : un signal peut
  // annoncer une entrée sans stop, ou un rr sans premier objectif, et l'écran
  // affiche alors un plan incomplet comme s'il était exécutable.
  const aEntree = c.entree !== null && c.entree !== undefined;
  const aStop = c.stop !== null && c.stop !== undefined;
  if (aEntree && !estNombre(c.entree)) invalides.push('entree : attendu un nombre');
  if (aStop && !estNombre(c.stop)) invalides.push('stop : attendu un nombre');
  if (aEntree && !aStop) invalides.push('entrée annoncée sans stop');
  if (!aEntree && aStop) invalides.push('stop annoncé sans entrée');
  if (aEntree && estTableau(c.objectifs) && !c.objectifs.length) {
    invalides.push('entrée annoncée sans premier objectif');
  }
  if (c.rr !== null && c.rr !== undefined) {
    if (!estNombre(c.rr)) invalides.push('rr : attendu un nombre ou null');
    else if (!aEntree || !aStop || !estTableau(c.objectifs) || !c.objectifs.length) {
      invalides.push('rr annoncé sans entrée, stop et premier objectif');
    }
  }

  return { ok: manquants.length === 0 && invalides.length === 0, manquants, invalides };
}

/** Même forme, valeurs neutres ajoutées. Aucun chiffre n'est inventé. */
function normaliserSignal(s) {
  const c = s && typeof s === 'object' ? { ...s } : {};
  if (c.entree === undefined) c.entree = null;
  if (c.stop === undefined) c.stop = null;
  if (c.rr === undefined) c.rr = null;
  if (!estTableau(c.objectifs)) c.objectifs = [];
  if (!estTableau(c.conditions)) c.conditions = [];
  if (!estTableau(c.preuves)) c.preuves = [];
  if (c.tf === undefined) c.tf = null;
  if (c.force === undefined) c.force = 0;
  return c;
}

/**
 * Le verdict du direct (`Signals.detect`) exprimé dans la même forme que les
 * signaux du multi. Aucun calcul nouveau : uniquement une traduction de champs.
 */
function versContrat(verdict, meta = {}) {
  const v = verdict || {};
  const l = v.levels || null;
  return normaliserSignal({
    id: 'verdict:global',
    source: 'verdict',
    nom: v.strategie && v.strategie.titre ? `Verdict — ${v.strategie.titre}` : 'Verdict global (R1–R8)',
    strategie: v.strategie ? (v.strategie.titre || null) : null,
    concept: 'règles SMC',
    tf: meta.timeframe || v.timeframe || null,
    sens: v.direction === 'BUY' ? 'long' : v.direction === 'SELL' ? 'short' : 'neutre',
    status: CONTRAT.statuts.includes(v.status) ? v.status : 'rejete',
    force: estNombre(v.strength) ? +Math.max(0, Math.min(1, v.strength)).toFixed(2) : 0,
    conditions: Array.isArray(v.checklist) ? v.checklist : [],
    preuves: Array.isArray(v.preuves) ? v.preuves : [],
    entree: l && estNombre(l.entry) ? l.entry : null,
    stop: l && estNombre(l.stop) ? l.stop : null,
    objectifs: l ? [l.target1, l.target2].filter(estNombre) : [],
    rr: l && estNombre(l.target1) && estNombre(l.stop) && estNombre(l.entry)
      && l.stop !== l.entry
      ? +Math.abs((l.target1 - l.entry) / (l.entry - l.stop)).toFixed(2) : null,
    // Deux notions que le mot « confirmé » confondait :
    //   reglesAlignees    = les règles R1–R8 sont d'accord (constat technique) ;
    //   executablePossible = des niveaux cohérents existent (rien à exécuter sinon).
    // Ni l'une ni l'autre ne dit que la DÉCISION autorise l'entrée : c'est le rôle
    // de DecisionEngine, et de lui seul.
    reglesAlignees: v.status === 'confirme',
    executablePossible: !!(l && estNombre(l.entry) && estNombre(l.stop) && estNombre(l.target1)),
    base: l ? (l.base || null) : null,
    raison: v.summary || null
  });
}

/**
 * SIGNAL NORMALIZER — absorbe les QUATRE vocabulaires du dépôt et rend la forme
 * unique du contrat.
 *
 *   1. signal multi ....... { sens:'long', entree, stop, objectifs, tf }
 *   2. verdict direct ..... { direction:'BUY', levels:{entry,stop,target1,target2}, timeframe }
 *   3. ligne de scan ...... { symbole, direction:'SELL', tf, force }
 *   4. entrée de journal .. { cle, symbol, timeframe, sens, entree, stop }
 *
 * Aucune valeur n'est inventée ni corrigée : ce qui manque reste null, et ce qui
 * est hors bornes est signalé par `validerSignal` (on ne masque pas un défaut en
 * le ramenant de force dans l'intervalle).
 */
const nombreOuNull = v => {
  if (Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

function sensNormalise(b) {
  if (CONTRAT.sens.includes(b.sens)) return b.sens;
  const d = String(b.direction || '').toUpperCase();
  if (d === 'BUY' || d === 'ACHAT' || d === 'LONG') return 'long';
  if (d === 'SELL' || d === 'VENTE' || d === 'SHORT') return 'short';
  if (CONTRAT.sens.includes(String(b.sens || '').toLowerCase())) return String(b.sens).toLowerCase();
  // Rien d'exploitable : INCONNU. Inventer « neutre » ferait passer une
  // stratégie muette pour une stratégie sans biais.
  return 'inconnu';
}

/** Direction publiée, dérivée du sens interne. */
function directionDe(sens) {
  if (sens === 'long') return 'BUY';
  if (sens === 'short') return 'SELL';
  if (sens === 'neutre') return 'NEUTRAL';
  return 'UNKNOWN';
}

function objectifsNormalises(b, l) {
  const brut = Array.isArray(b.objectifs) ? b.objectifs
    : [b.target1 ?? l.target1, b.target2 ?? l.target2].filter(v => v !== undefined && v !== null);
  return brut.map(nombreOuNull).filter(v => v !== null);
}

function normaliser(brut, options = {}) {
  if (!brut || typeof brut !== 'object') return null;
  const b = brut;
  const l = b.levels && typeof b.levels === 'object' ? b.levels : {};
  const symbol = b.symbol || b.symbole || options.symbol || null;
  const tf = b.tf || b.timeframe || options.timeframe || null;
  const sens = sensNormalise(b);
  const force = nombreOuNull(b.force !== undefined ? b.force : b.strength);

  return normaliserSignal({
    id: b.id || b.cle || `${b.source || options.source || 'signal'}:${symbol || '?'}:${tf || '?'}:${sens}`,
    source: CONTRAT.sources.includes(b.source) ? b.source : (options.source || 'strategie'),
    nom: b.nom || b.titre || b.strategie || 'Signal',
    strategie: b.strategie || null,
    concept: b.concept || null,
    symbol,
    tf,
    sens,
    // Deux informations distinctes, jamais fusionnées : la DIRECTION (ce que la
    // stratégie voit) et la DÉCISION (ce que le moteur autorise).
    direction: directionDe(sens),
    status: CONTRAT.statuts.includes(b.status) ? b.status
      : CONTRAT.statuts.includes(b.statut) ? b.statut : 'rejete',
    force: force === null ? 0 : force,
    conditions: Array.isArray(b.conditions) ? b.conditions : [],
    preuves: Array.isArray(b.preuves) ? b.preuves : [],
    entree: nombreOuNull(b.entree !== undefined ? b.entree : (b.entry !== undefined ? b.entry : l.entry)),
    stop: nombreOuNull(b.stop !== undefined ? b.stop : l.stop),
    objectifs: objectifsNormalises(b, l),
    rr: nombreOuNull(b.rr !== undefined ? b.rr : l.rr),
    base: b.base || null,
    raison: b.raison || b.note || null,
    qualite: b.qualite === undefined ? null : b.qualite
  });
}

module.exports = { CONTRAT, validerSignal, normaliserSignal, normaliser, versContrat };
