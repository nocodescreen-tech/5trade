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
 * Balayages de liquidité : une mèche dépasse un sommet (ou creux) puis la
 * bougie clôture de l'autre côté. C'est le « raid » : on est venu chercher les
 * stops, pas continuer. Différent d'une simple cassure.
 */
function sweeps(candles, w = 2) {
  const sw = swings(candles, w);
  const out = [];
  for (const s of sw) {
    for (let i = s.i + 1; i < candles.length; i++) {
      const c = candles[i];
      if (s.type === 'high' && c.h > s.price && c.c < s.price) {
        out.push({ type: 'balayage haut', level: +s.price.toFixed(6), extreme: +c.h.toFixed(6),
          at: c.t, reclaimed: true, depth: +((c.h - s.price) / s.price * 100).toFixed(3) });
        break;
      }
      if (s.type === 'low' && c.l < s.price && c.c > s.price) {
        out.push({ type: 'balayage bas', level: +s.price.toFixed(6), extreme: +c.l.toFixed(6),
          at: c.t, reclaimed: true, depth: +((s.price - c.l) / s.price * 100).toFixed(3) });
        break;
      }
    }
  }
  return out.slice(-4);
}

/**
 * Breakers : un order block qui a été cassé par la clôture. Il change de camp —
 * une zone de demande cassée devient une zone d'offre, et inversement. C'est la
 * « Breaker ∩ FVG » de la stratégie Unicorn.
 */
function breakers(candles, impulse = 3) {
  const out = [];
  for (let i = impulse; i < candles.length - 1; i++) {
    const c = candles[i], nxt = candles[i + 1];
    const priorHigh = Math.max(...candles.slice(i - impulse, i).map(x => x.h));
    const priorLow = Math.min(...candles.slice(i - impulse, i).map(x => x.l));
    if (c.c < c.o && nxt.c > priorHigh) {
      const k = candles.slice(i + 2).findIndex(x => x.c < c.l);
      if (k >= 0) out.push({ type: 'breaker baissier', low: +c.l.toFixed(6), high: +c.h.toFixed(6),
        i, t: c.t, brokenAt: candles[i + 2 + k].t });
    } else if (c.c > c.o && nxt.c < priorLow) {
      const k = candles.slice(i + 2).findIndex(x => x.c > c.h);
      if (k >= 0) out.push({ type: 'breaker haussier', low: +c.l.toFixed(6), high: +c.h.toFixed(6),
        i, t: c.t, brokenAt: candles[i + 2 + k].t });
    }
  }
  return out.slice(-4);
}

/**
 * Déplacement : bougie dont le corps dépasse k × ATR. C'est la signature d'une
 * entrée institutionnelle — sans déplacement, une cassure est suspecte.
 */
function displacements(candles, k = 1.5) {
  const a = atr(candles, 14);
  if (!a) return [];
  const out = [];
  for (const c of candles) {
    const body = Math.abs(c.c - c.o);
    if (body >= a * k) {
      out.push({ at: c.t, direction: c.c > c.o ? 'haussier' : 'baissier',
        from: c.o, to: c.c, multiple: +(body / a).toFixed(2) });
    }
  }
  return out.slice(-5);
}

/** Plus haut / plus bas du jour et de la semaine PRÉCÉDENTS (PDH/PDL/PWH/PWL). */
function previousLevels(candles) {
  const day = 86400e3;
  const lastT = candles[candles.length - 1].t;
  const todayStart = Math.floor(lastT / day) * day;
  const before = candles.filter(c => c.t < todayStart);
  if (!before.length) return null;                       // historique trop court
  const prevDayStart = Math.floor(before[before.length - 1].t / day) * day;
  const prevDay = before.filter(c => c.t >= prevDayStart);
  const r = {
    PDH: +Math.max(...prevDay.map(c => c.h)).toFixed(6),
    PDL: +Math.min(...prevDay.map(c => c.l)).toFixed(6)
  };
  const weekStart = todayStart - 7 * day;
  const lastWeek = candles.filter(c => c.t >= weekStart && c.t < todayStart);
  if (lastWeek.length) {
    r.PWH = +Math.max(...lastWeek.map(c => c.h)).toFixed(6);
    r.PWL = +Math.min(...lastWeek.map(c => c.l)).toFixed(6);
  }
  return r;
}

/** Fibonacci du dernier swing : les niveaux de retracement, OTE compris. */
function fibLevels(candles, w = 2) {
  const sw = swings(candles, w);
  const hi = sw.filter(s => s.type === 'high').slice(-1)[0];
  const lo = sw.filter(s => s.type === 'low').slice(-1)[0];
  if (!hi || !lo) return null;
  const top = Math.max(hi.price, lo.price), bot = Math.min(hi.price, lo.price);
  const d = top - bot;
  if (!d) return null;
  const levels = {};
  for (const [k, ratio] of [['0,236', 0.236], ['0,382', 0.382], ['0,5', 0.5],
    ['0,618', 0.618], ['0,705', 0.705], ['0,786', 0.786]]) {
    levels[k] = +(top - d * ratio).toFixed(6);
  }
  return {
    from: +bot.toFixed(6), to: +top.toFixed(6),
    sens: hi.i > lo.i ? 'haussier (dernier point bas → dernier point haut)' : 'baissier (dernier point haut → dernier point bas)',
    levels,
    ote: [+(bot + d * 0.618).toFixed(6), +(bot + d * 0.786).toFixed(6)]
  };
}

/** Sessions (heures UTC) : où la liquidité se prend réellement. */
const SESSIONS = [
  { id: 'asie', label: 'Asie (Tokyo)', from: 0, to: 8 },
  { id: 'londres', label: 'Londres', from: 7, to: 16 },
  { id: 'newyork', label: 'New York', from: 12, to: 21 },
  { id: 'overlap', label: 'Chevauchement Londres–New York', from: 12, to: 16 }
];

function sessions(candles) {
  const counts = {};
  for (const s of SESSIONS) counts[s.id] = 0;
  for (const c of candles) {
    const h = new Date(c.t).getUTCHours();
    for (const s of SESSIONS) {
      const inRange = s.from <= s.to ? (h >= s.from && h < s.to) : (h >= s.from || h < s.to);
      if (inRange) counts[s.id]++;
    }
  }
  const now = new Date(candles[candles.length - 1].t).getUTCHours();
  const actives = SESSIONS.filter(s => (s.from <= s.to ? now >= s.from && now < s.to : now >= s.from || now < s.to));
  return {
    sessionCourante: actives.map(s => s.label).join(' + ') || 'hors séance',
    killZone: (now >= 7 && now < 10) ? 'Londres (7 h–10 h UTC)'
      : (now >= 12 && now < 15) ? 'New York (12 h–15 h UTC)' : 'aucune en ce moment',
    compteParSession: counts
  };
}

/**
 * Inventaire : TOUT ce que le moteur a identifié, rangé par famille, avec son
 * état. C'est la matière première de l'analyse — rien n'est omis en silence.
 */
function inventory(r) {
  const items = [];
  const add = (famille, label, prix, etat, extra = {}) =>
    items.push({ famille, label, prix: Number.isFinite(prix) ? +(+prix).toFixed(6) : null, etat, ...extra });

  for (const s of (r.structure.recent || [])) add('Structure', s.label, s.price, 'point de repère');
  if (r.structure.event) add('Structure', `${r.structure.event.type} ${r.structure.event.direction}`,
    r.structure.event.level, 'cassure confirmée par la clôture');

  for (const f of r.fvgs) add('Imbalance', `FVG ${f.type === 'bullish' ? 'haussier' : 'baissier'}`,
    (f.low + f.high) / 2, 'ouvert (non comblé)', { zone: [f.low, f.high] });
  for (const o of r.orderBlocks) add('Order block', `OB ${o.type === 'bullish' ? 'haussier' : 'baissier'}`,
    (o.low + o.high) / 2, 'valide', { zone: [o.low, o.high] });
  for (const b of r.breakers) add('Breaker', b.type, (b.low + b.high) / 2, 'cassé — a changé de camp', { zone: [b.low, b.high] });
  for (const p of r.liquidity) add('Liquidité', p.type, p.price, 'stops accumulés', { touches: p.touches });
  for (const s of r.sweeps) add('Balayage', s.type, s.level, `balayé puis repris (${s.depth} %)`, { extreme: s.extreme });
  for (const d of r.displacements) add('Déplacement', d.direction, d.to, `corps ${d.multiple} × ATR`);

  if (r.premiumDiscount) {
    add('Range', 'Équilibre (50 %)', r.premiumDiscount.equilibrium, `prix en ${r.premiumDiscount.position}`);
    add('Range', 'OTE 0,618', r.premiumDiscount.ote.deep, 'zone d\'entrée privilégiée');
  }
  if (r.fibLevels) {
    for (const [k, v] of Object.entries(r.fibLevels.levels)) add('Fibonacci', `Retracement ${k}`, v, 'du dernier swing');
  }
  if (r.previousLevels) {
    for (const [k, v] of Object.entries(r.previousLevels)) {
      add('Période précédente', k, v, k.startsWith('P') && k.endsWith('H') ? 'plus haut de référence' : 'plus bas de référence');
    }
  }
  const families = {};
  for (const it of items) families[it.famille] = (families[it.famille] || 0) + 1;
  return { items, total: items.length, parFamille: families };
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
    breakers: breakers(clean),
    liquidity: liquidityPools(clean),
    sweeps: sweeps(clean),
    displacements: displacements(clean),
    previousLevels: previousLevels(clean),
    fibLevels: fibLevels(clean),
    sessions: sessions(clean),
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
  for (const f of r.fvgs.slice(-3)) levels.push({ kind: `FVG ${f.type}`, price: +((f.low + f.high) / 2).toFixed(6), zone: [f.low, f.high], side: f.type === 'bullish' ? 'support' : 'resistance' });
  for (const o of r.orderBlocks.slice(-3)) levels.push({ kind: `OB ${o.type}`, price: +((o.low + o.high) / 2).toFixed(6), zone: [o.low, o.high], side: o.type === 'bullish' ? 'support' : 'resistance' });
  for (const b of r.breakers.slice(-2)) levels.push({ kind: b.type, price: +((b.low + b.high) / 2).toFixed(6), zone: [b.low, b.high], side: b.type.includes('haussier') ? 'support' : 'resistance' });
  for (const p of r.liquidity) levels.push({ kind: p.type, price: p.price, side: 'liquidité' });
  for (const s of r.sweeps.slice(-2)) levels.push({ kind: s.type, price: s.level, side: 'liquidité' });
  if (r.previousLevels) {
    for (const [k, v] of Object.entries(r.previousLevels)) levels.push({ kind: k, price: v, side: k.endsWith('H') ? 'resistance' : 'support' });
  }
  if (r.premiumDiscount) {
    levels.push({ kind: 'OTE 0,618', price: r.premiumDiscount.ote.deep, side: 'entrée' });
    levels.push({ kind: 'équilibre', price: r.premiumDiscount.equilibrium, side: 'pivot' });
  }
  r.levels = levels;

  // Inventaire complet : tout ce qui a été identifié, par famille.
  r.inventory = inventory(r);

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
    r.breakers.length ? `Breakers : ${r.breakers.map(b => `${b.type} ${b.low}–${b.high}`).join(' | ')}` : '',
    r.liquidity.length ? `Liquidité : ${r.liquidity.map(p => `${p.type} ${p.price}`).join(' | ')}` : 'Pas de pool de liquidité évident',
    r.sweeps.length ? `Balayages : ${r.sweeps.map(x => `${x.type} à ${x.level}`).join(' | ')}` : '',
    r.displacements.length ? `Déplacements : ${r.displacements.map(d => `${d.direction} ${d.multiple}×ATR`).join(' | ')}` : '',
    r.previousLevels ? `Période précédente : ${Object.entries(r.previousLevels).map(([k, v]) => `${k} ${v}`).join(' | ')}` : '',
    r.fibLevels ? `Fibonacci du dernier swing (${r.fibLevels.sens}) : ${Object.entries(r.fibLevels.levels).map(([k, v]) => `${k} ${v}`).join(' | ')}` : '',
    r.sessions ? `Session en cours : ${r.sessions.sessionCourante} · kill zone ${r.sessions.killZone}` : '',
    `Dernière bougie : ${r.lastCandle.direction}, mèche haute ${r.lastCandle.wick.upper} / basse ${r.lastCandle.wick.lower}`,
    `Inventaire : ${r.inventory.total} éléments identifiés (${Object.entries(r.inventory.parFamille).map(([k, v]) => `${k} ${v}`).join(', ')})`
  ].filter(Boolean).join('\n');

  return r;
}

module.exports = {
  analyze, atr, swings, marketStructure, fvgs, orderBlocks, liquidityPools,
  premiumDiscount, lastCandleInfo, sweeps, breakers, displacements,
  previousLevels, fibLevels, sessions, inventory
};
