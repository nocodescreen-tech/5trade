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

/** R3 — réaction dans un order block / FVG (le prix y entre puis rejette). */
function ruleZone(candles, report) {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const zones = [
    ...(report.orderBlocks || []).map(z => ({ ...z, kind: 'order block' })),
    ...(report.fvgs || []).map(z => ({ ...z, kind: 'FVG' }))
  ];
  for (const z of zones) {
    const touched = prev && prev.l <= z.high && prev.h >= z.low;   // on est entré dans la zone
    if (!touched) continue;
    const range = Math.max(last.h - last.l, 1e-9);
    const body = Math.abs(last.c - last.o) / range;
    if (z.type === 'bullish' && last.c > z.high) {
      return {
        rule: 'R3', name: `Rejet sur ${z.kind} haussier`, direction: 'BUY',
        strength: +(0.5 + Math.min(body, 0.5) * 0.6).toFixed(3),
        detail: `zone ${num(z.low)}–${num(z.high)} touchée puis clôture au-dessus`,
        level: num(z.high)
      };
    }
    if (z.type === 'bearish' && last.c < z.low) {
      return {
        rule: 'R3', name: `Rejet sur ${z.kind} baissier`, direction: 'SELL',
        strength: +(0.5 + Math.min(body, 0.5) * 0.6).toFixed(3),
        detail: `zone ${num(z.low)}–${num(z.high)} touchée puis clôture en dessous`,
        level: num(z.low)
      };
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
 * Verdict sur la dernière bougie clôturée.
 * @returns {{status:'confirme'|'surveiller'|'neutre', direction:string,
 *            strength:number, rules:Array, confirmations:number,
 *            levels:object, summary:string, at:number}}
 */
function detect(candles, meta = {}) {
  const clean = (candles || []).filter(c => c && Number.isFinite(c.c));
  if (clean.length < 20) throw new Error('Pas assez de bougies (20 minimum)');

  const report = S.analyze(clean, meta);
  const rules = [ruleSweep(clean, report), ruleBreak(clean, report), ruleZone(clean, report), rulePosition(report)]
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

  // Confirmation = au moins 2 règles indépendantes du même côté.
  const status = (independent >= 2 && strength >= 0.35) ? 'confirme'
    : (independent >= 1 && strength >= 0.3) ? 'surveiller' : 'neutre';

  const levels = levelsFor(report, status === 'neutre' ? 'NEUTRE' : direction);
  const fmt = v => (v === null ? '—' : v);

  const summary = status === 'neutre'
    ? `Aucun signal : les règles ne concordent pas (${rules.length} détectée(s)).`
    : `${direction === 'BUY' ? 'ACHAT' : 'VENTE'} ${status === 'confirme' ? 'CONFIRMÉ' : 'à surveiller'}`
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
    price: report.lastPrice,
    trend: report.structure.trend,
    summary,
    context: {
      trend: report.structure.trend,
      event: report.structure.event,
      position: report.premiumDiscount ? report.premiumDiscount.position : null,
      atr14: report.atr14
    }
  };
}

module.exports = { detect, ruleSweep, ruleBreak, ruleZone, rulePosition, levelsFor };
