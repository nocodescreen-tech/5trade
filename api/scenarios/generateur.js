/**
 * 5trade — SCÉNARIOS : générateur (plan d'attente).
 *
 * Différence avec le reste du moteur : ici on ne dit pas « achète ». On dit
 * « SI le prix revient à ce niveau-là ET que la clôture confirme, ALORS on
 * prépare un long ». Le niveau, le stop et les objectifs sortent tous de la
 * structure mesurée (zone réelle, ATR réel, liquidité réelle).
 *
 * Aucune valeur n'est inventée :
 *   - pas d'ATR → pas de scénario (on ne fabrique pas un stop) ;
 *   - pas de zone sous/sur le prix → pas de scénario, avec le motif ;
 *   - les objectifs sont des liquidités identifiées, sinon un multiple du risque
 *     et c'est écrit dans les preuves.
 *
 * Les conditions portent `obligatoire: true|false` : le blueprint comptait
 * « 3 conditions sur 4 », mais une majorité ne doit pas compenser une condition
 * structurelle manquante. L'entrée est toujours obligatoire.
 */

const Structure = require('../engine/structure');
const Parcours = require('../engine/parcours-prix');

const TTL_MS = 3 * 3600 * 1000;

/** Zone encore utilisable : ni cassée, ni expirée. */
function zoneUtilisable(z, candles, atr) {
  const etat = Parcours.etatZone(z, candles, { atr });
  return etat.etat !== 'BROKEN' && etat.etat !== 'EXPIRED' ? etat : null;
}

/**
 * Objectifs en R — le point où le plan et la gestion se contredisaient.
 *
 * Le générateur posait TP1 sur « la première liquidité au-delà de 1,2 × risque,
 * sinon 2 × risque ». Le plan de gestion, lui, parle de TP1 = 1,27 R (50 %),
 * TP2 = 2 R (30 %). Résultat mesuré en rejeu : TP1 presque jamais atteint, et
 * 22 trades sur 43 coupés par l'invalidation temporelle.
 *
 * Règle retenue, celle d'un trader qui sécurise :
 *   - TP1 = la première liquidité RÉELLE dans la bande [tp1R, 1,6 × tp1R] ;
 *     à défaut, un palier au multiple du risque (on ne fabrique pas un niveau,
 *     on assume un multiple) ;
 *   - TP2 = la première liquidité à au moins tp2R et strictement au-delà de TP1 ;
 *     à défaut, un multiple du risque au-delà de TP1.
 */
function cibles(entree, risque, sens, liquidites, tp1R, tp2R) {
  const s = sens === 'long' ? 1 : -1;
  const enR = prix => ((prix - entree) * s) / risque;

  const bande = liquidites
    .filter(l => { const r = enR(l.prix); return r >= tp1R && r <= tp1R * 1.6; })
    .sort((a, b) => enR(a.prix) - enR(b.prix));
  const tp1 = bande.length ? bande[0].prix : entree + s * risque * tp1R;

  const auDela = liquidites
    .filter(l => enR(l.prix) >= Math.max(tp2R, enR(tp1) + 0.5))
    .sort((a, b) => enR(a.prix) - enR(b.prix));
  const tp2 = auDela.length ? auDela[0].prix : entree + s * risque * Math.max(tp2R, enR(tp1) + 0.5);

  return {
    tp1, tp2,
    sourceTP1: bande.length ? 'liquidité' : 'multiple du risque',
    sourceTP2: auDela.length ? 'liquidité' : 'multiple du risque',
    rrTP1: +enR(tp1).toFixed(2),
    rrTP2: +enR(tp2).toFixed(2)
  };
}

/**
 * Construit 0 à 2 scénarios pour un instrument, à partir des bougies réelles.
 * @returns {{scenarios: Array, motif: string|null}}
 */
function generer(candles, meta = {}, options = {}) {
  const serie = (candles || []).filter(c => c && c.closed !== false);
  if (serie.length < 60) return { scenarios: [], motif: `série trop courte (${serie.length} bougies)` };

  let report;
  try { report = Structure.analyze(serie); } catch (e) {
    return { scenarios: [], motif: `structure indisponible : ${e.message}` };
  }
  const atr = Number(report && (report.atr14 || report.atr));
  const prix = Number(report && report.lastPrice);
  if (!Number.isFinite(atr) || atr <= 0) return { scenarios: [], motif: 'ATR indisponible : aucun stop calculable' };
  if (!Number.isFinite(prix)) return { scenarios: [], motif: 'prix courant indisponible' };

  const zones = [
    ...((report.orderBlocks || []).map(z => ({ ...z, origine: 'order block' }))),
    ...((report.fvgs || []).map(z => ({ ...z, origine: 'FVG' })))
  ].filter(z => Number.isFinite(z.low) && Number.isFinite(z.high));

  // Tendance mesurée : elle décide QUELLES directions ont le droit d'exister.
  // Sans ce filtre, XAUUSD produisait un long ET un short simultanément — deux
  // plans contradictoires présentés comme également valables. En tendance, on
  // ne prépare que le sens de la tendance ; en range, les deux bords sont des
  // plans conditionnels légitimes (et c'est écrit).
  const tendance = String(
    (report && ((report.structure && report.structure.trend) || report.trend)) || ''
  ).toLowerCase();
  const autoriseLong = tendance !== 'bearish';
  const autoriseShort = tendance !== 'bullish';
  const motifTendance = tendance === 'bullish' ? 'tendance haussière : long seulement'
    : tendance === 'bearish' ? 'tendance baissière : short seulement'
      : 'pas de tendance nette : les deux bords sont des plans conditionnels';

  const liquidites = (report.liquidityPools || [])
    .map(l => ({ prix: Number(l.prix ?? l.price ?? l.level), type: l.type }))
    .filter(l => Number.isFinite(l.prix));

  // Multiples de sécurisation : réglables par les seuils appris (tp1_r / tp2_r).
  // Les défauts sont ceux du plan de gestion — une seule doctrine dans le dépôt.
  const tp1R = Number.isFinite(Number(options.tp1R)) && Number(options.tp1R) > 0 ? Number(options.tp1R) : 1.27;
  const tp2R = Number.isFinite(Number(options.tp2R)) && Number(options.tp2R) > 0 ? Number(options.tp2R) : 2.0;

  const scenarios = [];
  const motifParts = [];

  // ── LONG : zone haussière SOUS le prix (retest), dans le sens du marché ──
  const longZones = (autoriseLong ? zones : [])
    .filter(z => z.type === 'bullish' && z.high < prix)
    .sort((a, b) => b.high - a.high);          // la plus proche d'abord
  for (const z of longZones) {
    const etat = zoneUtilisable(z, serie, atr);
    if (!etat) continue;
    const entree = z.high;
    const stop = z.low - atr;
    const risque = entree - stop;
    if (!(risque > 0)) continue;

    const ob = cibles(entree, risque, 'long', liquidites, tp1R, tp2R);
    const tp1 = ob.tp1;
    const tp2 = ob.tp2;

    scenarios.push({
      instrument: meta.symbol || null,
      timeframe: meta.timeframe || null,
      direction: 'long',
      niveauEntree: +entree.toFixed(6),
      stop: +stop.toFixed(6),
      tp1: +tp1.toFixed(6),
      tp2: +tp2.toFixed(6),
      conditions: [
        // L'entrée est structurelle : sans elle, il n'y a pas de setup.
        { type: 'prix_atteint', valeur: +entree.toFixed(6), obligatoire: true },
        { type: 'cloture_au_dessus', valeur: +entree.toFixed(6), obligatoire: false }
      ],
      preuves: [
        `${z.origine} haussier ${+z.low.toFixed(4)}–${+z.high.toFixed(4)} à ${((prix - z.high) / atr).toFixed(2)} ATR sous le prix`,
        `zone ${String(etat.etat).toLowerCase()} (${etat.preuves[0] || 'sans détail'})`,
        `ATR(14) = ${atr.toFixed(4)} · stop sous la zone`,
        `TP1 = ${ob.rrTP1} R (${ob.sourceTP1}) · TP2 = ${ob.rrTP2} R (${ob.sourceTP2})`
      ],
      ttlMs: TTL_MS
    });
    break;                                      // un seul long, le plus proche
  }
  if (!autoriseLong) motifParts.push('long écarté — ' + motifTendance);
  else if (!longZones.length) motifParts.push('aucune zone haussière sous le prix');

  // ── SHORT : zone baissière AU-DESSUS du prix ──
  const shortZones = (autoriseShort ? zones : [])
    .filter(z => z.type === 'bearish' && z.low > prix)
    .sort((a, b) => a.low - b.low);
  for (const z of shortZones) {
    const etat = zoneUtilisable(z, serie, atr);
    if (!etat) continue;
    const entree = z.low;
    const stop = z.high + atr;
    const risque = stop - entree;
    if (!(risque > 0)) continue;

    const ob = cibles(entree, risque, 'short', liquidites, tp1R, tp2R);
    const tp1 = ob.tp1;
    const tp2 = ob.tp2;

    scenarios.push({
      instrument: meta.symbol || null,
      timeframe: meta.timeframe || null,
      direction: 'short',
      niveauEntree: +entree.toFixed(6),
      stop: +stop.toFixed(6),
      tp1: +tp1.toFixed(6),
      tp2: +tp2.toFixed(6),
      conditions: [
        { type: 'prix_atteint', valeur: +entree.toFixed(6), obligatoire: true },
        { type: 'cloture_en_dessous', valeur: +entree.toFixed(6), obligatoire: false }
      ],
      preuves: [
        `${z.origine} baissier ${+z.low.toFixed(4)}–${+z.high.toFixed(4)} à ${((z.low - prix) / atr).toFixed(2)} ATR au-dessus du prix`,
        `zone ${String(etat.etat).toLowerCase()} (${etat.preuves[0] || 'sans détail'})`,
        `ATR(14) = ${atr.toFixed(4)} · stop au-dessus de la zone`,
        `TP1 = ${ob.rrTP1} R (${ob.sourceTP1}) · TP2 = ${ob.rrTP2} R (${ob.sourceTP2})`
      ],
      ttlMs: TTL_MS
    });
    break;
  }
  if (!autoriseShort) motifParts.push('short écarté — ' + motifTendance);
  else if (!shortZones.length) motifParts.push('aucune zone baissière au-dessus du prix');

  // ── Alignement H4 + D1 ────────────────────────────────────────────────────
  // Règle intraday : on ne prépare pas un plan contre l'alignement supérieur.
  // L'alignement est CALCULÉ par l'appelant (il faut de l'historique H1) et
  // passé ici : le générateur ne devine pas la tendance supérieure à partir de
  // la série courante. Sans alignement fourni, rien n'est filtré et le motif
  // le dit — un filtre silencieux serait pire qu'aucun filtre.
  const alignement = options.alignement || null;
  if (alignement && alignement.aligne === true) {
    for (let i = scenarios.length - 1; i >= 0; i--) {
      if (scenarios[i].direction !== alignement.direction) {
        motifParts.push(`${scenarios[i].direction} écarté — contre l’alignement ${alignement.direction} (H4 ${alignement.H4} / D1 ${alignement.D1})`);
        scenarios.splice(i, 1);
      }
    }
  }

  return {
    scenarios,
    motif: scenarios.length ? null : (motifParts.join(' · ') || 'aucune configuration exploitable'),
    atr: +atr.toFixed(6),
    prix: +prix.toFixed(6),
    tendance: tendance || 'inconnue',
    alignement: alignement || null,
    ciblesR: { tp1R, tp2R }
  };
}

module.exports = { generer, cibles, TTL_MS };
