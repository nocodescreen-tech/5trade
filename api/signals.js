/**
 * 5trade — moteur de signaux.
 *
 * Rôle : dire QUAND quelque chose se produit, et QUOI. Là où structure.js
 * décrit un état (« tendance haussière, FVG ici »), ce module rend un verdict
 * exploitable : « achat confirmé », avec les règles qui le confirment, le
 * niveau d'entrée, l'invalidation et l'objectif.
 *
 * RÈGLES (chacune apporte une voix ; le verdict est une pondération) :
 *   R1 balayage de liquidité  — mèche au-delà d'un niveau puis clôture à l'intérieur
 *   R2 rupture de structure   — BOS / CHoCH confirmé par une clôture
 *   R3 réaction en zone       — entrée dans un order block / FVG puis rejet
 *   R4 position dans le range — achat en discount, vente en premium
 *
 * Un signal n'est « confirmé » que si AU MOINS deux règles indépendantes
 * pointent dans le même sens. Une seule voix = « à surveiller », pas « achat ».
 * Fonctions pures : entrée = bougies, sortie = données chiffrées.
 */
const S = require('./structure');

const num = v => (Number.isFinite(v) ? +v.toFixed(6) : null);

/** R1 — balayage de liquidité (« sweep ») sur la dernière bougie clôturée. */
function ruleSweep(candles, report) {
  const last = candles[candles.length - 1];
  if (!last) return null;

  // Niveaux où des stops sont accumulés : creux/sommets égaux, swings récents.
  const levels = [
    ...(report.liquidity || []).map(p => ({ price: p.price, kind: p.type })),
    report.structure.lastSwingLow ? { price: report.structure.lastSwingLow.price, kind: 'swing low' } : null,
    report.structure.lastSwingHigh ? { price: report.structure.lastSwingHigh.price, kind: 'swing high' } : null
  ].filter(Boolean);

  for (const lv of levels) {
    // Balayage haussier : on perce SOUS le niveau, puis on clôture AU-DESSUS.
    if (last.l < lv.price && last.c > lv.price) {
      const wick = last.c - last.o !== 0 ? Math.min(last.o, last.c) - last.l : last.c - last.l;
      const range = Math.max(last.h - last.l, 1e-9);
      return {
        rule: 'R1', name: 'Balayage de liquidité',
        direction: 'BUY', strength: +(Math.min(wick / range, 0.9)).toFixed(3),
        detail: `mèche sous ${lv.kind} ${num(lv.price)} puis clôture au-dessus (${num(last.c)})`,
        level: num(lv.price)
      };
    }
    // Balayage baissier : on perce AU-DESSUS, puis on clôture EN DESSOUS.
    if (last.h > lv.price && last.c < lv.price) {
      const wick = last.h - Math.max(last.o, last.c);
      const range = Math.max(last.h - last.l, 1e-9);
      return {
        rule: 'R1', name: 'Balayage de liquidité',
        direction: 'SELL', strength: +(Math.min(wick / range, 0.9)).toFixed(3),
        detail: `mèche au-dessus de ${lv.kind} ${num(lv.price)} puis clôture en dessous (${num(last.c)})`,
        level: num(lv.price)
      };
    }
  }
  return null;
}

/** R2 — BOS / CHoCH confirmé par la clôture. */
function ruleBreak(candles, report) {
  const e = report.structure.event;
  if (!e) return null;
  const last = candles[candles.length - 1];
  const range = Math.max(last.h - last.l, 1e-9);
  // Un CHoCH vaut plus qu'un BOS (il annonce un retournement, pas une continuation).
  const base = e.type === 'CHoCH' ? 0.75 : 0.6;
  const pierce = Math.min(Math.abs(last.c - e.level) / range, 1);
  return {
    rule: 'R2', name: e.type === 'CHoCH' ? 'Changement de caractère' : 'Rupture de structure',
    direction: e.direction === 'bullish' ? 'BUY' : 'SELL',
    strength: +Math.min(base + pierce * 0.2, 0.95).toFixed(3),
    detail: `clôture ${num(last.c)} au-delà du niveau ${num(e.level)}`,
    level: num(e.level)
  };
}

/**
 * R3 — réaction dans un order block / FVG.
 *
 * Deux corrections par rapport à la première version, révélées par la lecture
 * d'un vrai graphique :
 *  1. La POSITION dans le range décide. Une zone de demande (haussier) touchée
 *     en PREMIUM est un piège : le prix vient d'en haut, la réaction naturelle
 *     est baissière. Confirmer un achat là-dessus est l'erreur la plus coûteuse.
 *     On achète une zone de demande quand le prix vient d'en bas (discount), et
 *     on vend une zone d'offre quand le prix vient d'en haut (premium).
 *  2. Une zone touchée puis CASSÉE est une information, pas un non-événement :
 *     l'échec d'une zone haussière en premium est un signal de VENTE.
 */
function ruleZone(candles, report) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (!prev) return null;
  const pd = report.premiumDiscount;
  const position = pd ? pd.position : null;   // 'premium' | 'discount' | null
  const zones = [
    ...(report.orderBlocks || []).map(z => ({ ...z, kind: 'order block' })),
    ...(report.fvgs || []).map(z => ({ ...z, kind: 'FVG' }))
  ];
  const range = Math.max(last.h - last.l, 1e-9);
  const body = Math.abs(last.c - last.o) / range;
  const strength = +(0.5 + Math.min(body, 0.5) * 0.6).toFixed(3);
  const where = position || 'zone neutre';

  for (const z of zones) {
    const touched = prev.l <= z.high && prev.h >= z.low;   // on est entré dans la zone
    if (!touched) continue;

    if (z.type === 'bullish') {
      // Zone de demande : achat seulement si le prix vient d'en bas.
      if (last.c > z.high && position !== 'premium') {
        return {
          rule: 'R3', name: `Rejet sur ${z.kind} haussier`, direction: 'BUY', strength,
          detail: `zone ${num(z.low)}–${num(z.high)} touchée puis clôture au-dessus (prix en ${where})`,
          level: num(z.high)
        };
      }
      // Piège : zone de demande prise par le haut, puis cédée → vente.
      if (last.c < z.low && position === 'premium') {
        return {
          rule: 'R3', name: `Échec de ${z.kind} haussier en premium`, direction: 'SELL', strength,
          detail: `zone ${num(z.low)}–${num(z.high)} atteinte en premium puis cassée vers le bas`,
          level: num(z.low)
        };
      }
    }

    if (z.type === 'bearish') {
      // Zone d'offre : vente seulement si le prix vient d'en haut.
      if (last.c < z.low && position !== 'discount') {
        return {
          rule: 'R3', name: `Rejet sur ${z.kind} baissier`, direction: 'SELL', strength,
          detail: `zone ${num(z.low)}–${num(z.high)} touchée puis clôture en dessous (prix en ${where})`,
          level: num(z.low)
        };
      }
      if (last.c > z.high && position === 'discount') {
        return {
          rule: 'R3', name: `Échec de ${z.kind} baissier en discount`, direction: 'BUY', strength,
          detail: `zone ${num(z.low)}–${num(z.high)} atteinte en discount puis cassée vers le haut`,
          level: num(z.high)
        };
      }
    }
  }
  return null;
}

/** R4 — position dans le range : on achète en discount, on vend en premium. */
function rulePosition(report) {
  const pd = report.premiumDiscount;
  if (!pd) return null;
  const trend = report.structure.trend;
  if (pd.position === 'discount' && trend !== 'bearish') {
    return {
      rule: 'R4', name: 'Prix en discount',
      direction: 'BUY', strength: 0.4,
      detail: `prix ${num(report.lastPrice)} sous l'équilibre ${num(pd.equilibrium)}`,
      level: num(pd.equilibrium)
    };
  }
  if (pd.position === 'premium' && trend !== 'bullish') {
    return {
      rule: 'R4', name: 'Prix en premium',
      direction: 'SELL', strength: 0.4,
      detail: `prix ${num(report.lastPrice)} au-dessus de l'équilibre ${num(pd.equilibrium)}`,
      level: num(pd.equilibrium)
    };
  }
  return null;
}

/** Niveaux d'entrée / invalidation / objectif à partir du verdict. */
function levelsFor(report, direction) {
  const price = report.lastPrice;
  const atr = report.atr14 || Math.abs(price) * 0.001;
  // Attention : pour un achat l'invalidation se place sous un CREUX, pour une
  // vente au-dessus d'un SOMMET. (Une première version prenait le sommet dans
  // les deux cas : le stop se retrouvait du mauvais côté.)
  const low = report.structure.lastSwingLow;
  const high = report.structure.lastSwingHigh;

  if (direction === 'BUY') {
    const structural = low && Number.isFinite(low.price) ? low.price : price - atr * 1.5;
    const stop = Math.min(structural, price - atr * 0.5);         // jamais trop près
    const targets = [
      report.structure.lastSwingHigh && report.structure.lastSwingHigh.price,
      ...(report.liquidity || []).filter(p => p.price > price).map(p => p.price)
    ].filter(p => p && p > price).sort((a, b) => a - b);
    return {
      entry: num(price), stop: num(stop),
      target1: num(targets[0] || price + atr * 2),
      target2: num(targets[1] || price + atr * 3)
    };
  }
  if (direction === 'SELL') {
    const structural = high && Number.isFinite(high.price) ? high.price : price + atr * 1.5;
    const stop = Math.max(structural, price + atr * 0.5);
    const targets = [
      report.structure.lastSwingLow && report.structure.lastSwingLow.price,
      ...(report.liquidity || []).filter(p => p.price < price).map(p => p.price)
    ].filter(p => p && p < price).sort((a, b) => b - a);
    return {
      entry: num(price), stop: num(stop),
      target1: num(targets[0] || price - atr * 2),
      target2: num(targets[1] || price - atr * 3)
    };
  }
  return { entry: num(price), stop: null, target1: null, target2: null };
}

/**
 * Les DEUX scénarios chiffrés, quel que soit le verdict en cours.
 * Savoir quoi faire si ça monte ET si ça descend est plus utile qu'un
 * « neutre » sec : c'est le plan, pas seulement le constat.
 */
function scenarios(report) {
  const zones = [...(report.orderBlocks || []), ...(report.fvgs || [])];
  const support = zones.filter(z => z.type === 'bullish').sort((a, b) => b.high - a.high)[0];
  const resistance = zones.filter(z => z.type === 'bearish').sort((a, b) => a.low - b.low)[0];
  const hi = report.structure.lastSwingHigh;
  const lo = report.structure.lastSwingLow;
  const zoneTxt = z => (z ? `réaction depuis ${z.low}–${z.high} (${z.kind || (z.type === 'bullish' ? 'zone haussière' : 'zone baissière')})` : null);

  return {
    bullish: {
      direction: 'BUY',
      trigger: hi ? `clôture au-dessus de ${num(hi.price)}` : 'clôture au-dessus du dernier sommet',
      context: zoneTxt(support) || 'réaction sur un support',
      ...levelsFor(report, 'BUY')
    },
    bearish: {
      direction: 'SELL',
      trigger: lo ? `clôture sous ${num(lo.price)}` : 'clôture sous le dernier creux',
      context: zoneTxt(resistance) || 'rejet sous une résistance',
      ...levelsFor(report, 'SELL')
    }
  };
}

/** Conditions évaluées une par une : on montre ce qui est rempli et ce qui manque. */
function checklist(report) {
  const st = report.structure;
  const pd = report.premiumDiscount;
  const zones = [...(report.orderBlocks || []), ...(report.fvgs || [])];
  return [
    { key: 'tendance', label: 'Tendance définie', ok: st.trend !== 'range', detail: st.trend },
    { key: 'rupture', label: 'Rupture de structure (clôture)', ok: !!st.event,
      detail: st.event ? `${st.event.type} ${st.event.direction} à ${num(st.event.level)}` : 'aucune cassure de clôture' },
    { key: 'liquidite', label: 'Liquidité prise', ok: (report.liquidity || []).length > 0,
      detail: (report.liquidity || []).map(p => `${p.type} ${num(p.price)}`).join(', ') || 'aucun pool de liquidité' },
    { key: 'zone', label: 'Zone réactive (order block / FVG)', ok: zones.length > 0,
      detail: zones.length ? `${zones.length} zone(s) ouverte(s)` : 'aucune zone valide' },
    { key: 'position', label: 'Position favorable dans le range', ok: !!pd && pd.position !== null,
      detail: pd ? `${pd.position} (équilibre ${num(pd.equilibrium)})` : 'range indéterminé' }
  ];
}

/** Les quatre familles de règles, adressables par identifiant. */
const TOUTES_REGLES = {
  R1: (candles, report) => ruleSweep(candles, report),
  R2: (candles, report) => ruleBreak(candles, report),
  R3: (candles, report) => ruleZone(candles, report),
  R4: (candles, report) => rulePosition(report)
};

const sansAccents = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Ce qu'une stratégie de la base demande de surveiller, déduit de son texte.
 * Une stratégie « Liquidity Sweep » n'a pas à être jugée sur les Fibonacci :
 * on lit ce qu'elle décrit et on n'active que les règles correspondantes.
 * Si le texte ne dit rien d'exploitable, on applique tout (mieux que rien).
 */
const MOTIFS_REGLE = [
  { regles: ['R1'], motifs: /sweep|balayage|liquidit|raid|stop.?hunt|chasse|manipulat/ },
  { regles: ['R2'], motifs: /bos|break of structure|changement de caractere|rupture|mss|market structure|structure shift|\bchoch\b|tendance|trend|breakout|cassure|retournement|reversal|pullback/ },
  { regles: ['R3'], motifs: /order block|\bob\b|fvg|fair value|imbalance|mitigation|breaker|zone de reaction|support|resistance/ },
  { regles: ['R4'], motifs: /premium|discount|ote|fibonacci|retracement|equilibre|golden zone/ },
  { regles: ['R1', 'R2'], motifs: /momentum|continuation|impulsion|impulse/ },
  // « Price action » au sens large : structure + zones + liquidité.
  { regles: ['R1', 'R2', 'R3'], motifs: /price action/ }
];

function profilDepuisStrategie(doc) {
  const texte = sansAccents(`${doc.title || ''} ${doc.content || ''} ${(doc.tags || []).join(' ')}`);
  const trouvees = [...new Set(MOTIFS_REGLE.filter(m => m.motifs.test(texte)).flatMap(m => m.regles))];
  const tous = Object.keys(TOUTES_REGLES);
  const regles = trouvees.length ? trouvees : tous;
  return {
    id: doc.id || null,
    titre: doc.title || null,
    regles,
    // Une stratégie mono-règle ne peut pas croiser deux confirmations : on exige
    // alors davantage de force, sinon elle ne confirmerait jamais rien.
    seuilRegles: regles.length >= 2 ? 2 : 1,
    seuilForce: regles.length >= 2 ? 0.35 : 0.6,
    deduitDuTexte: trouvees.length > 0,
    motif: trouvees.length ? 'règles déduites du texte de la stratégie'
      : 'texte sans indication : toutes les règles appliquées'
  };
}

/**
 * Verdict sur la dernière bougie clôturée.
 * @param {Array} candles bougies OHLCV
 * @param {{symbol?:string, timeframe?:string}} meta
 * @param {{regles?:string[], seuilForce?:number, seuilRegles?:number,
 *          strategie?:{id:string, titre:string}}} [options]
 *        `regles` restreint l'analyse à certaines familles : c'est ce qui permet
 *        d'analyser SELON une stratégie précise au lieu d'un verdict unique.
 * @returns {{status, direction, strength, rules, confirmations, scenarios,
 *            checklist, missing, levels, summary, at, strategie}}
 */
function detect(candles, meta = {}, options = {}) {
  const clean = (candles || []).filter(c => c && Number.isFinite(c.c));
  if (clean.length < 20) throw new Error('Pas assez de bougies (20 minimum)');

  const report = S.analyze(clean, meta);

  // Règles actives : celles demandées, sinon toutes.
  const demandees = Array.isArray(options.regles) ? options.regles.filter(r => TOUTES_REGLES[r]) : [];
  const actives = demandees.length ? demandees : Object.keys(TOUTES_REGLES);
  const rules = actives
    .map(id => { try { return TOUTES_REGLES[id](clean, report); } catch { return null; } })
    .filter(Boolean);

  const buy = rules.filter(r => r.direction === 'BUY');
  const sell = rules.filter(r => r.direction === 'SELL');
  const winner = buy.length >= sell.length ? buy : sell;
  const loser = buy.length >= sell.length ? sell : buy;
  const direction = winner.length ? winner[0].direction : 'NEUTRE';

  const independent = new Set(winner.map(r => r.rule)).size;

  // Force = moyenne des voix gagnantes, RENFORCÉE par la concordance et
  // affaiblie par la contradiction. Deux règles d'accord valent mieux que
  // chacune prise seule — sinon une confirmation ne vaudrait rien de plus.
  const avg = winner.length ? winner.reduce((a, r) => a + r.strength, 0) / winner.length : 0;
  const bonus = 0.1 * Math.max(0, independent - 1);
  const penalty = 0.1 * loser.length;
  const strength = +Math.max(0, Math.min(avg + bonus - penalty, 1)).toFixed(3);

  // Confirmation = règles indépendantes du même côté, au seuil demandé.
  // Une stratégie mono-règle (ex. « order blocks ») ne peut pas croiser deux
  // confirmations : son profil relève alors le seuil de force (voir plus haut).
  const seuilRegles = Number.isFinite(options.seuilRegles) ? options.seuilRegles : 2;
  const seuilForce = Number.isFinite(options.seuilForce) ? options.seuilForce : 0.35;
  const seuilSurveiller = Math.max(0.3, seuilForce - 0.05);
  const status = (independent >= seuilRegles && strength >= seuilForce) ? 'confirme'
    : (independent >= 1 && strength >= seuilSurveiller) ? 'surveiller' : 'neutre';

  // Pourquoi ce n'est pas confirmé : on l'écrit au lieu de laisser deviner.
  const missing = [];
  if (status !== 'confirme') {
    if (independent < seuilRegles) {
      missing.push(`il faut ${seuilRegles} règle(s) concordante(s) (${independent} pour l'instant)`);
    }
    if (strength < seuilForce) {
      missing.push(`force ${(strength * 100).toFixed(0)} % < ${(seuilForce * 100).toFixed(0)} % requis`);
    }
    if (!winner.length) missing.push('aucune règle déclenchée sur la dernière bougie clôturée');
  }

  const sc = scenarios(report);
  const chk = checklist(report);
  // Niveaux « du jour » : ceux du sens détecté, sinon les deux scénarios restent
  // consultables (on ne cache plus l'information sous prétexte d'incertitude).
  const levels = status === 'neutre'
    ? { entry: null, stop: null, target1: null, target2: null }
    : levelsFor(report, direction);
  const fmt = v => (v === null || v === undefined ? '—' : v);

  const entete = options.strategie && options.strategie.titre
    ? `[${options.strategie.titre}] ` : '';
  const summary = status === 'neutre'
    ? `${entete}Aucun signal confirmé : ${missing.join(' ; ') || 'conditions insuffisantes'}.`
      + ` Scénarios : achat si ${sc.bullish.trigger}, vente si ${sc.bearish.trigger}.`
    : `${entete}${direction === 'BUY' ? 'ACHAT' : 'VENTE'} ${status === 'confirme' ? 'CONFIRMÉ' : 'à surveiller'}`
      + ` — ${independent} règle(s) : ${winner.map(r => r.name).join(' + ')}`
      + ` · force ${(strength * 100).toFixed(0)} %`
      + ` · entrée ${fmt(levels.entry)} / invalidation ${fmt(levels.stop)} / objectifs ${fmt(levels.target1)} puis ${fmt(levels.target2)}`;

  return {
    at: clean[clean.length - 1].t,
    symbol: meta.symbol || null,
    timeframe: meta.timeframe || null,
    status, direction, strength,
    confirmations: independent,
    rules,
    levels,
    scenarios: sc,
    checklist: chk,
    missing,
    price: report.lastPrice,
    trend: report.structure.trend,
    summary,
    // Traçabilité : quelles règles ont été appliquées, et au nom de quoi.
    reglesActives: actives,
    seuils: { regles: seuilRegles, force: seuilForce },
    strategie: options.strategie || null,
    context: {
      trend: report.structure.trend,
      event: report.structure.event,
      position: report.premiumDiscount ? report.premiumDiscount.position : null,
      atr14: report.atr14
    }
  };
}

module.exports = {
  detect, scenarios, checklist, levelsFor, profilDepuisStrategie, TOUTES_REGLES,
  ruleSweep, ruleBreak, ruleZone, rulePosition
};
