/**
 * Risk Engine — exposition du portefeuille.
 *
 * Le dimensionnement par trade ne protège de rien si l'on empile dix positions qui
 * misent la même chose. Ce module regarde l'ENSEMBLE : risque cumulé, nombre de
 * positions simultanées, corrélation entre instruments, et série de pertes en cours.
 *
 * Il ne connaît ni le broker ni les ordres : il raisonne sur des positions
 * déclarées (symbole, direction, risque en devise, entrée, stop).
 */

const nombre = v => (Number.isFinite(Number(v)) ? Number(v) : null);

const LIMITES = {
  risqueCumulePct: 6,        // risque total simultané, en % du capital
  positionsMax: 6,           // positions ouvertes en même temps
  correlationMax: 0.7,       // corrélation absolue au-delà de laquelle deux positions se doublonnent
  pertesConsecutivesMax: 3   // au-delà, on arrête d'ajouter du risque
};

/** Rendements logarithmiques d'une série de clôtures. */
function rendements(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) {
    const a = Number(closes[i - 1]), b = Number(closes[i]);
    if (a > 0 && b > 0) r.push(Math.log(b / a));
  }
  return r;
}

/**
 * Corrélation de Pearson entre deux séries de clôtures, sur la fenêtre commune.
 * @returns {number|null} null si le calcul n'a pas de sens (séries trop courtes)
 */
function correlation(closesA, closesB) {
  const a = rendements((closesA || []).filter(Number.isFinite));
  const b = rendements((closesB || []).filter(Number.isFinite));
  const n = Math.min(a.length, b.length);
  if (n < 20) return null;
  const A = a.slice(-n), B = b.slice(-n);
  const ma = A.reduce((s, v) => s + v, 0) / n;
  const mb = B.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = A[i] - ma, y = B[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da === 0 || db === 0) return null;
  return Math.round((num / Math.sqrt(da * db)) * 1000) / 1000;
}

/**
 * Série de pertes en cours (la plus récente d'abord).
 * @param {Array<{r:number}>} trades ordre chronologique
 */
function pertesEnCours(trades) {
  const t = (trades || []).filter(x => x && Number.isFinite(Number(x.r)));
  let n = 0;
  for (let i = t.length - 1; i >= 0; i--) {
    if (Number(t[i].r) < 0) n++;
    else break;
  }
  return n;
}

/**
 * Vérifie qu'une nouvelle position peut être ajoutée.
 *
 * @param {object} p
 *   capital          capital de référence
 *   nouvelle         { symbole, direction, risqueMontant }
 *   ouvertes         [{ symbole, direction, risqueMontant }]
 *   series           { SYMBOLE: [clôtures] } pour la corrélation
 *   trades           historique tranché, pour la série de pertes
 *   limites          surcharge des seuils
 * @returns {{ok:boolean, bloquants:string[], avertissements:string[], mesures:object}}
 */
function verifier(p = {}) {
  const limites = { ...LIMITES, ...(p.limites || {}) };
  const bloquants = [];
  const avertissements = [];
  const capital = nombre(p.capital);
  const nouvelle = p.nouvelle || null;
  const ouvertes = Array.isArray(p.ouvertes) ? p.ouvertes : [];
  const series = p.series || {};
  const mesures = {};

  if (!capital || capital <= 0) {
    return { ok: false, bloquants: ['capital inconnu : aucune limite ne peut être vérifiée'],
      avertissements, mesures };
  }

  const risque = v => {
    const m = nombre(v);
    if (m !== null) return m;
    return 0;
  };
  const risqueOuvert = ouvertes.reduce((s, x) => s + risque(x.risqueMontant), 0);
  const risqueNouveau = nouvelle ? risque(nouvelle.risqueMontant) : 0;
  const cumule = risqueOuvert + risqueNouveau;

  mesures.risqueOuvertPct = Math.round((risqueOuvert / capital) * 1000) / 10;
  mesures.risqueCumulePct = Math.round((cumule / capital) * 1000) / 10;
  mesures.plafondPct = limites.risqueCumulePct;
  mesures.positions = ouvertes.length + (nouvelle ? 1 : 0);

  if (mesures.risqueCumulePct > limites.risqueCumulePct) {
    bloquants.push(`risque cumulé ${mesures.risqueCumulePct} % > plafond ${limites.risqueCumulePct} %`);
  }
  if (mesures.positions > limites.positionsMax) {
    bloquants.push(`${mesures.positions} positions simultanées > maximum ${limites.positionsMax}`);
  }

  // Corrélation : deux positions très corrélées ne diversifient rien.
  if (nouvelle && nouvelle.symbole && series[nouvelle.symbole]) {
    const correlees = [];
    for (const o of ouvertes) {
      if (!o.symbole || o.symbole === nouvelle.symbole) continue;
      if (!series[o.symbole]) continue;
      const c = correlation(series[nouvelle.symbole], series[o.symbole]);
      if (c === null) continue;
      if (Math.abs(c) >= limites.correlationMax) {
        const memeSens = String(o.direction || '').toUpperCase() === String(nouvelle.direction || '').toUpperCase();
        correlees.push({ symbole: o.symbole, correlation: c, memeSens });
      }
    }
    mesures.correlees = correlees;
    const doublons = correlees.filter(c => c.memeSens);
    if (doublons.length) {
      bloquants.push('position(s) déjà ouverte(s) corrélée(s) dans le même sens : '
        + doublons.map(c => `${c.symbole} (${c.correlation})`).join(', '));
    }
    const opposes = correlees.filter(c => !c.memeSens);
    if (opposes.length) {
      avertissements.push('position(s) corrélée(s) en sens inverse : couverture partielle — '
        + opposes.map(c => `${c.symbole} (${c.correlation})`).join(', '));
    }
  }

  // Série de pertes : continuer à ajouter du risque après trois échecs est un
  // comportement de joueur, pas de gestionnaire.
  if (Array.isArray(p.trades)) {
    const serie = pertesEnCours(p.trades);
    mesures.pertesConsecutives = serie;
    if (serie >= limites.pertesConsecutivesMax) {
      bloquants.push(`${serie} pertes consécutives : pause exigée avant toute nouvelle position `
        + `(seuil ${limites.pertesConsecutivesMax})`);
    } else if (serie > 0) {
      avertissements.push(`${serie} perte(s) consécutive(s) en cours`);
    }
  }

  return { ok: bloquants.length === 0, bloquants, avertissements, mesures };
}

module.exports = { verifier, correlation, pertesEnCours, LIMITES, rendements };
