/**
 * 5trade — analyse de structure sur données EXACTES (OHLCV).
 *
 * Le problème résolu : quand un modèle lit un graphique sur une capture, il
 * approxime les niveaux. Ici tout est calculé depuis les bougies réelles —
 * swings, BOS/CHoCH, FVG, order blocks, liquidité, premium/discount, ATR.
 * Le modèle ne devine plus les prix : il reçoit des nombres et rédige le plan.
 *
 * Toutes les fonctions sont pures (entrée : bougies ; sortie : données
 * chiffrées), donc vérifiables sans réseau.
 */

/** Bougie attendue : { t, o, h, l, c, v }. */
const isCandle = c => c && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c);

/** Vrai range moyen (Wilder simplifié) — sert à dimensionner SL/TP. */
function atr(candles, period = 14) {
  if (candles.length < 2) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const p = candles[i - 1], c = candles[i];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  const n = Math.min(period, trs.length);
  const slice = trs.slice(-n);
  return +(slice.reduce((a, x) => a + x, 0) / n).toFixed(6);
}

/**
 * Swings (fractals) : un sommet est plus haut que `w` bougies de chaque côté.
 * @returns {Array<{i:number, price:number, type:'high'|'low', t:number}>}
 */
function swings(candles, w = 2) {
  const out = [];
  for (let i = w; i < candles.length - w; i++) {
    const c = candles[i];
    let isHigh = true, isLow = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (candles[j].h >= c.h) isHigh = false;
      if (candles[j].l <= c.l) isLow = false;
    }
    if (isHigh) out.push({ i, price: c.h, type: 'high', t: c.t });
    if (isLow) out.push({ i, price: c.l, type: 'low', t: c.t });
  }
  return out;
}

/**
 * Structure de marché : tendance, dernier BOS / CHoCH, et les
 * derniers points de repère (HH/HL/LH/LL).
 */
function marketStructure(candles, w = 2) {
  const sw = swings(candles, w);
  const highs = sw.filter(s => s.type === 'high');
  const lows = sw.filter(s => s.type === 'low');

  const label = (arr) => {
    const seq = [];
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1], cur = arr[i];
      if (cur.type === 'high') seq.push({ ...cur, label: cur.price > prev.price ? 'HH' : 'LH' });
      else seq.push({ ...cur, label: cur.price > prev.price ? 'HL' : 'LL' });
    }
    return seq;
  };
  const labelled = label([...sw].sort((a, b) => a.i - b.i));
  const last = candles[candles.length - 1];

  // Tendance : on regarde les 2 derniers sommets et les 2 derniers creux.
  const lastH = highs.slice(-2), lastL = lows.slice(-2);
  let trend = 'range';
  if (lastH.length === 2 && lastL.length === 2) {
    const highUp = lastH[1].price > lastH[0].price;
    const lowUp = lastL[1].price > lastL[0].price;
    if (highUp && lowUp) trend = 'bullish';
    else if (!highUp && !lowUp) trend = 'bearish';
  }

  // BOS / CHoCH : cassure de clôture au-delà du dernier swing, dans le sens
  // ou contre la tendance en place.
  let event = null;
  const refHigh = lastH[lastH.length - 1];
  const refLow = lastL[lastL.length - 1];
  if (refHigh && last.c > refHigh.price) {
    event = { type: trend === 'bullish' ? 'BOS' : 'CHoCH', direction: 'bullish', level: refHigh.price, at: refHigh.i };
  } else if (refLow && last.c < refLow.price) {
    event = { type: trend === 'bearish' ? 'BOS' : 'CHoCH', direction: 'bearish', level: refLow.price, at: refLow.i };
  }

  return {
    trend,
    lastSwingHigh: refHigh ? { price: refHigh.price, t: refHigh.t } : null,
    lastSwingLow: refLow ? { price: refLow.price, t: refLow.t } : null,
    event,
    recent: labelled.slice(-6).map(s => ({ label: s.label, price: s.price, t: s.t })),
    counts: { highs: highs.length, lows: lows.length }
  };
}

/** Fair Value Gaps (imbalances sur 3 bougies) encore non comblés. */
function fvgs(candles) {
  const out = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2], c = candles[i];
    if (a.h < c.l) {                          // gap haussier
      const zone = { type: 'bullish', low: a.h, high: c.l, i: i - 1, t: candles[i - 1].t };
      const filled = candles.slice(i + 1).some(x => x.l <= zone.low);
      if (!filled) out.push(zone);
    } else if (a.l > c.h) {                    // gap baissier
      const zone = { type: 'bearish', low: c.h, high: a.l, i: i - 1, t: candles[i - 1].t };
      const filled = candles.slice(i + 1).some(x => x.h >= zone.high);
      if (!filled) out.push(zone);
    }
  }
  return out.slice(-6);
}

/**
 * Order blocks : la dernière bougie de sens opposé avant une impulsion
 * (mouvement qui dépasse le haut/bas des `impulse` bougies précédentes).
 */
function orderBlocks(candles, impulse = 3) {
  const out = [];
  for (let i = impulse; i < candles.length - 1; i++) {
    const c = candles[i], nxt = candles[i + 1];
    const priorHigh = Math.max(...candles.slice(i - impulse, i).map(x => x.h));
    const priorLow = Math.min(...candles.slice(i - impulse, i).map(x => x.l));
    if (c.c < c.o && nxt.c > priorHigh) {       // OB haussier
      const zone = { type: 'bullish', low: c.l, high: c.h, i, t: c.t };
      const broken = candles.slice(i + 2).some(x => x.c < zone.low);
      if (!broken) out.push(zone);
    } else if (c.c > c.o && nxt.c < priorLow) { // OB baissier
      const zone = { type: 'bearish', low: c.l, high: c.h, i, t: c.t };
      const broken = candles.slice(i + 2).some(x => x.c > zone.high);
      if (!broken) out.push(zone);
    }
  }
  return out.slice(-5);
}

/**
 * Liquidité : sommets (ou creux) quasi égaux → les stops s'y accumulent.
 * Égalité = écart relatif < tol (0,0008 = 0,08 %).
 */
function liquidityPools(candles, tol = 0.0008, w = 2) {
  const sw = swings(candles, w);
  const pools = [];
  for (const type of ['high', 'low']) {
    const arr = sw.filter(s => s.type === type);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        if (Math.abs(a.price - b.price) / a.price <= tol) {
          pools.push({
            type: type === 'high' ? 'EQH' : 'EQL',
            price: +((a.price + b.price) / 2).toFixed(6),
            touches: 2,
            t: b.t
          });
          break;
        }
      }
    }
  }
  return pools.slice(-4);
}

/** Premium / discount sur le dernier range significatif. */
function premiumDiscount(candles, w = 2) {
  const sw = swings(candles, w);
  const hi = sw.filter(s => s.type === 'high').slice(-1)[0];
  const lo = sw.filter(s => s.type === 'low').slice(-1)[0];
  if (!hi || !lo) return null;
  const high = Math.max(hi.price, lo.price), low = Math.min(hi.price, lo.price);
  const mid = (high + low) / 2;
  const last = candles[candles.length - 1].c;
  return {
    high: +high.toFixed(6), low: +low.toFixed(6), equilibrium: +mid.toFixed(6),
    position: last > mid ? 'premium' : 'discount',
    // 0,618 / 0,5 / 0,382 : niveaux d'entrée classiques du range
    ote: {
      deep: +(low + (high - low) * 0.618).toFixed(6),
      mid: +mid.toFixed(6),
      shallow: +(low + (high - low) * 0.382).toFixed(6)
    }
  };
}

/** État de la dernière bougie (utile pour dire « le marché vient de… »). */
function lastCandleInfo(candles) {
  const c = candles[candles.length - 1], p = candles[candles.length - 2];
  if (!c) return null;
  const body = Math.abs(c.c - c.o);
  const range = c.h - c.l;
  const upperWick = c.h - Math.max(c.o, c.c);
  const lowerWick = Math.min(c.o, c.c) - c.l;
  return {
    t: c.t, o: c.o, h: c.h, l: c.l, c: c.c,
    direction: c.c > c.o ? 'bullish' : c.c < c.o ? 'bearish' : 'flat',
    bodyRatio: range ? +(body / range).toFixed(3) : 0,
    wick: {
      upper: range ? +(upperWick / range).toFixed(3) : 0,
      lower: range ? +(lowerWick / range).toFixed(3) : 0
    },
    changePct: p && p.c ? +(((c.c - p.c) / p.c) * 100).toFixed(4) : null
  };
}

/**
 * Rapport complet, chiffré, prêt à être donné au modèle.
 * @param {Array} candles bougies OHLCV (ordre chronologique)
 * @param {{symbol?:string, timeframe?:string}} meta
 */
function analyze(candles, meta = {}) {
  const clean = (candles || []).filter(isCandle);
  if (clean.length < 20) throw new Error('Pas assez de bougies pour analyser (20 minimum)');
  const last = clean[clean.length - 1];

  const r = {
    symbol: meta.symbol || null,
    timeframe: meta.timeframe || null,
    candles: clean.length,
    from: clean[0].t, to: last.t,
    lastPrice: last.c,
    atr14: atr(clean, 14),
    structure: marketStructure(clean),
    fvgs: fvgs(clean),
    orderBlocks: orderBlocks(clean),
    liquidity: liquidityPools(clean),
    premiumDiscount: premiumDiscount(clean),
    lastCandle: lastCandleInfo(clean),
    range20: {
      high: +Math.max(...clean.slice(-20).map(c => c.h)).toFixed(6),
      low: +Math.min(...clean.slice(-20).map(c => c.l)).toFixed(6)
    }
  };

  // Niveaux exploitables : ce que le plan doit utiliser comme SL/TP
  const levels = [];
  if (r.structure.event) levels.push({ kind: r.structure.event.type, price: r.structure.event.level, side: r.structure.event.direction });
  if (r.structure.lastSwingHigh) levels.push({ kind: 'swing high', price: r.structure.lastSwingHigh.price, side: 'resistance' });
  if (r.structure.lastSwingLow) levels.push({ kind: 'swing low', price: r.structure.lastSwingLow.price, side: 'support' });
  for (const f of r.fvgs.slice(-3)) levels.push({ kind: `FVG ${f.type}`, price: +( (f.low + f.high) / 2 ).toFixed(6), zone: [f.low, f.high], side: f.type === 'bullish' ? 'support' : 'resistance' });
  for (const o of r.orderBlocks.slice(-3)) levels.push({ kind: `OB ${o.type}`, price: +((o.low + o.high) / 2).toFixed(6), zone: [o.low, o.high], side: o.type === 'bullish' ? 'support' : 'resistance' });
  for (const p of r.liquidity) levels.push({ kind: p.type, price: p.price, side: 'liquidité' });
  if (r.premiumDiscount) levels.push({ kind: 'OTE 0,618', price: r.premiumDiscount.ote.deep, side: 'entrée' });
  r.levels = levels;

  // Résumé lisible : c'est ce texte (chiffré) qui part au modèle
  const s = r.structure;
  r.summary = [
    `${r.symbol || 'Actif'} ${r.timeframe || ''} — dernier prix ${r.lastPrice}`,
    `Tendance : ${s.trend}${s.event ? ` · ${s.event.type} ${s.event.direction} à ${s.event.level}` : ''}`,
    s.lastSwingHigh ? `Dernier sommet ${s.lastSwingHigh.price} / dernier creux ${s.lastSwingLow?.price}` : '',
    r.premiumDiscount ? `Range ${r.premiumDiscount.low}–${r.premiumDiscount.high}, équilibre ${r.premiumDiscount.equilibrium} → prix en ${r.premiumDiscount.position}` : '',
    `ATR(14) = ${r.atr14}`,
    r.fvgs.length ? `FVG ouverts : ${r.fvgs.map(f => `${f.type} ${f.low}–${f.high}`).join(' | ')}` : 'Aucun FVG ouvert',
    r.orderBlocks.length ? `Order blocks : ${r.orderBlocks.map(o => `${o.type} ${o.low}–${o.high}`).join(' | ')}` : 'Aucun order block valide',
    r.liquidity.length ? `Liquidité : ${r.liquidity.map(p => `${p.type} ${p.price}`).join(' | ')}` : 'Pas de pool de liquidité évident',
    `Dernière bougie : ${r.lastCandle.direction}, mèche haute ${r.lastCandle.wick.upper} / basse ${r.lastCandle.wick.lower}`
  ].filter(Boolean).join('\n');

  return r;
}

module.exports = { analyze, atr, swings, marketStructure, fvgs, orderBlocks, liquidityPools, premiumDiscount, lastCandleInfo };
