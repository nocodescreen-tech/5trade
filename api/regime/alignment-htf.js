/**
 * 5trade — RÉGIME : alignement multi-utilité de temps (H4 + D1).
 *
 * Règle du cahier des charges intraday : on ne trade pas contre l'alignement
 * H4 + D1. Le dépôt ne le vérifiait nulle part — le H1 décidait seul.
 *
 * Le module ne réinvente pas une tendance : il RÉÉCHANTILLONNE les bougies H1
 * fournies, puis demande la tendance au module de structure déjà utilisé partout
 * (`marketStructure`). Une seule définition de « tendance » dans le système.
 *
 * Quand l'historique est trop court pour un bloc, la réponse est `inconnu` et
 * son motif — jamais une direction inventée pour faire passer un trade.
 */

const Structure = require('../engine/structure');

const MIN_BLOCS = { H4: 20, D1: 20 };

/**
 * Agrège des bougies H1 en blocs de `heures` heures.
 * Les blocs incomplets (dernier bloc partiel) sont écartés : une bougie D1
 * formée sur 7 heures n'est pas un jour.
 */
function resampler(candles, heures) {
  const h = Math.max(1, Math.round(Number(heures) || 1));
  const source = (candles || [])
    .filter(c => c && Number.isFinite(c.t) && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c))
    .sort((a, b) => a.t - b.t);
  const blocs = [];
  let courant = null;
  for (const c of source) {
    const d = new Date(c.t);
    let ancre;
    if (h === 24) {
      ancre = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    } else {
      const heureBloc = Math.floor(d.getUTCHours() / h) * h;
      ancre = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), heureBloc);
    }
    if (!courant || courant.t !== ancre) {
      if (courant) blocs.push(courant);
      courant = { t: ancre, o: c.o, h: c.h, l: c.l, c: c.c, closed: true, n: 1 };
    } else {
      courant.h = Math.max(courant.h, c.h);
      courant.l = Math.min(courant.l, c.l);
      courant.c = c.c;
      courant.n += 1;
    }
  }
  if (courant) blocs.push(courant);
  // Seul le DERNIER bloc peut être en cours de formation : les autres sont des
  // périodes révolues. Exiger 24 bougies par jour était faux : un jour férié ou
  // un trou de flux laisse 16 heures, et la journée restait un jour. On écarte
  // donc uniquement le bloc final s'il est incomplet — pas les journées creuses.
  if (blocs.length && blocs[blocs.length - 1].n < h) blocs.pop();
  return blocs;
}

/** Pente normalisée par l'ATR : mesure de secours quand aucun swing n'existe. */
function penteOriente(blocs) {
  const a = Structure.atr(blocs, 14);
  if (!Number.isFinite(a) || a <= 0 || blocs.length < 3) return { direction: 'inconnu', motif: 'pente non mesurable (ATR indisponible)' };
  const premiers = blocs.slice(-Math.min(blocs.length, 20));
  const variation = (premiers[premiers.length - 1].c - premiers[0].c) / (premiers.length - 1);
  const pente = variation / a;               // fraction d'ATR par bloc
  if (pente > 0.15) return { direction: 'long', motif: `pente +${pente.toFixed(2)} ATR/bloc (aucun swing mesurable)` };
  if (pente < -0.15) return { direction: 'short', motif: `pente ${pente.toFixed(2)} ATR/bloc (aucun swing mesurable)` };
  return { direction: 'neutre', motif: `pente ${pente.toFixed(2)} ATR/bloc : pas de direction` };
}

/** Tendance d'une série de blocs, via la définition unique du dépôt. */
function orienter(blocs, minimum) {
  const min = Number(minimum) || 12;
  if (!Array.isArray(blocs) || blocs.length < min) {
    return { direction: 'inconnu', motif: `${blocs ? blocs.length : 0} blocs < ${min} requis`, blocs: blocs ? blocs.length : 0 };
  }
  let ms;
  try {
    ms = Structure.marketStructure(blocs, 2);
  } catch (e) {
    return { direction: 'inconnu', motif: `structure indisponible : ${e.message}`, blocs: blocs.length };
  }
  // Une série sans aucun swing (marché qui monte/descend sans respirer) n'est pas
  // un « range » : c'est une absence de mesure. On le dit et on mesure la pente,
  // plutôt que d'annoncer « neutre » sur une tendance évidente.
  const aucunSwing = !ms.counts || (ms.counts.highs === 0 && ms.counts.lows === 0);
  const direction = ms.trend === 'bullish' ? 'long' : ms.trend === 'bearish' ? 'short' : 'neutre';
  if (direction === 'neutre' && aucunSwing) {
    const p = penteOriente(blocs);
    return { direction: p.direction, motif: p.motif, blocs: blocs.length, methode: 'pente' };
  }
  return { direction, motif: `structure ${ms.trend} sur ${blocs.length} blocs`, blocs: blocs.length, methode: 'structure' };
}

/**
 * Alignement H4 + D1.
 *
 * @param {object} p
 * @param {Array}  [p.h1] bougies H1 (source de rééchantillonnage)
 * @param {Array}  [p.h4] blocs H4 déjà agrégés (prioritaire s'il est fourni)
 * @param {Array}  [p.d1] blocs D1 déjà agrégés (prioritaire s'il est fourni)
 * @returns {{H4:string, D1:string, direction:string, aligne:boolean, resume:string, motifs:Array<string>}}
 */
function aligner({ h1, h4, d1 } = {}) {
  const blocsH4 = Array.isArray(h4) && h4.length ? h4 : resampler(h1, 4);
  const blocsD1 = Array.isArray(d1) && d1.length ? d1 : resampler(h1, 24);

  const o4 = orienter(blocsH4, MIN_BLOCS.H4);
  const o1 = orienter(blocsD1, MIN_BLOCS.D1);

  const motifs = [`H4 : ${o4.direction} (${o4.motif})`, `D1 : ${o1.direction} (${o1.motif})`];

  let direction = 'neutre';
  let aligne = false;
  if (o4.direction === 'long' && o1.direction === 'long') { direction = 'long'; aligne = true; }
  else if (o4.direction === 'short' && o1.direction === 'short') { direction = 'short'; aligne = true; }
  else if (o4.direction === 'neutre' || o1.direction === 'neutre' || o4.direction === 'inconnu' || o1.direction === 'inconnu') {
    direction = 'neutre';
    motifs.push('pas d’alignement mesurable : biais neutre');
  } else {
    motifs.push('H4 et D1 divergent : aucune direction autorisée');
  }

  return {
    H4: o4.direction,
    D1: o1.direction,
    direction,
    aligne,
    resume: aligne
      ? `aligné ${direction} (H4 ${o4.direction}, D1 ${o1.direction})`
      : (direction === 'neutre' ? 'biais neutre (pas d’alignement H4+D1)' : 'alignement contraire'),
    motifs
  };
}

/**
 * Cette direction est-elle autorisée par l'alignement ?
 * Sans alignement mesuré, on ne refuse pas : on le dit (`motif`), et c'est
 * l'appelant qui choisit d'exiger `aligne` (option `exigeAlignement`).
 */
function autorise(alignement, direction, options = {}) {
  const dir = String(direction || '').toLowerCase();
  if (!alignement || !alignement.direction) {
    return { ok: !options.exigeAlignement, raison: 'alignement indisponible' };
  }
  if (alignement.direction === 'neutre' || alignement.direction === 'inconnu') {
    return { ok: !options.exigeAlignement, raison: 'pas d’alignement H4+D1 mesurable' };
  }
  if (alignement.direction !== dir) {
    return { ok: false, raison: `trade ${dir} contre l’alignement ${alignement.direction} (H4 ${alignement.H4} / D1 ${alignement.D1})` };
  }
  return { ok: true, raison: `dans le sens de l’alignement ${alignement.direction}` };
}

module.exports = { aligner, resampler, orienter, autorise, MIN_BLOCS };
