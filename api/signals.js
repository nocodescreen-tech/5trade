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
function levelsFor(report, direction, atrStop) {
  const price = report.lastPrice;
  const atr = report.atr14 || Math.abs(price) * 0.001;
  // Multiplicateur de stop réglable par la stratégie (défaut 1,5 × ATR) : un
  // scalpeur veut un stop serré, un suiveur de tendance un stop large.
  const k = Number.isFinite(atrStop) ? atrStop : 1.5;
  // Attention : pour un achat l'invalidation se place sous un CREUX, pour une
  // vente au-dessus d'un SOMMET. (Une première version prenait le sommet dans
  // les deux cas : le stop se retrouvait du mauvais côté.)
  const low = report.structure.lastSwingLow;
  const high = report.structure.lastSwingHigh;

  if (direction === 'BUY') {
    const structural = low && Number.isFinite(low.price) ? low.price : price - atr * k;
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
    const structural = high && Number.isFinite(high.price) ? high.price : price + atr * k;
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
 * Les DEUX scénarios, avec leur PRIORITÉ et des chiffres concrets.
 *
 * Avant, c'étaient deux blocs symétriques toujours formulés pareil : même
 * phrase, même structure, seule la valeur changeait. Ici le scénario est
 * rattaché à ce qui existe réellement sur le graphique — la zone la plus proche
 * du prix, le pool de liquidité le plus proche, la distance en % et en ATR —
 * et l'un des deux est désigné comme privilégié, avec sa raison.
 */
function scenarios(report, atrStop) {
  // Même multiplicateur que levelsFor : le repli ATR doit rester cohérent avec
  // le stop réellement proposé.
  const k = Number.isFinite(atrStop) ? atrStop : 1.5;
  const prix = report.lastPrice;
  const atr = report.atr14 || Math.abs(prix) * 0.001;
  const st = report.structure;
  const pd = report.premiumDiscount;
  const zones = [...(report.orderBlocks || []), ...(report.fvgs || [])];
  const liq = report.liquidity || [];

  const distPct = n => (Number.isFinite(n) ? +Math.abs((n - prix) / prix * 100).toFixed(2) : null);
  const distAtr = n => (Number.isFinite(n) ? +(Math.abs(n - prix) / atr).toFixed(1) : null);
  const ou = (n, t) => (Number.isFinite(n) ? `${num(n)} (${distPct(n)} %${t ? `, ${distAtr(n)}× ATR` : ''})` : null);

  // Ce qui est réellement en face : zone la plus proche de chaque côté,
  // et pool de liquidité le plus proche (les cibles naturelles du marché).
  const support = zones.filter(z => z.type === 'bullish' && z.high <= prix)
    .sort((a, b) => b.high - a.high)[0];
  const resistance = zones.filter(z => z.type === 'bearish' && z.low >= prix)
    .sort((a, b) => a.low - b.low)[0];
  const liqHaut = liq.filter(p => p.price > prix).sort((a, b) => a.price - b.price)[0];
  const liqBas = liq.filter(p => p.price < prix).sort((a, b) => b.price - a.price)[0];

  // Repli quand aucune zone n'est en face : un swing, l'OTE, puis l'ATR.
  // Il faut TOUJOURS un chiffre — « repli sur le support le plus proche » sans
  // valeur ne dit rien et rendait tous les scénarios identiques.
  const repli = st.lastSwingLow ? st.lastSwingLow.price : (pd ? pd.ote.deep : prix - atr * k);
  const repliHaut = st.lastSwingHigh ? st.lastSwingHigh.price : (pd ? pd.ote.shallow : prix + atr * k);

  const contexteAchat = support
    ? `repli dans ${num(support.low)}–${num(support.high)} (${support.kind || 'zone de demande'}), à ${distPct(support.high)} % du prix`
    : `repli vers ${num(repli)} (${distPct(repli)} %, ${distAtr(repli)}× ATR)`
      + (st.lastSwingLow ? ' — dernier creux' : pd ? ' — niveau OTE' : ' — repli d\'un ATR et demi');

  const contexteVente = resistance
    ? `rejet de ${num(resistance.low)}–${num(resistance.high)} (${resistance.kind || 'zone d\'offre'}), à ${distPct(resistance.low)} % du prix`
    : `montée vers ${num(repliHaut)} (${distPct(repliHaut)} %, ${distAtr(repliHaut)}× ATR)`
      + (st.lastSwingHigh ? ' — dernier sommet' : pd ? ' — niveau OTE' : ' — extension d\'un ATR et demi');

  // Biais : la tendance ET la position dans le range. C'est ce qui départage les
  // deux scénarios — sinon ils auraient toujours le même poids.
  let biais = 'neutre', raisonBiais = 'range sans direction nette : attendre une cassure';
  if (st.trend === 'bullish' && pd && pd.position === 'discount') {
    biais = 'haussier'; raisonBiais = 'tendance haussière et prix en discount : contexte d\'achat complet';
  } else if (st.trend === 'bearish' && pd && pd.position === 'premium') {
    biais = 'baissier'; raisonBiais = 'tendance baissière et prix en premium : contexte de vente complet';
  } else if (st.trend === 'bullish') {
    biais = 'haussier'; raisonBiais = 'tendance haussière mais prix en premium : acheter sur repli, pas au sommet';
  } else if (st.trend === 'bearish') {
    biais = 'baissier'; raisonBiais = 'tendance baissière mais prix en discount : vendre sur rebond, pas au creux';
  }

  const acheteur = {
    direction: 'BUY',
    priorite: biais === 'haussier' ? 'principale' : 'alternative',
    trigger: st.lastSwingHigh ? `clôture au-dessus de ${num(st.lastSwingHigh.price)}` : 'clôture au-dessus du dernier sommet',
    context: contexteAchat,
    // La cible la plus proche au-dessus : c'est là que le marché va chercher.
    objectifProche: liqHaut ? `${liqHaut.type} à ${ou(liqHaut.price, true)}` : null,
    ...levelsFor(report, 'BUY')
  };

  const vendeur = {
    direction: 'SELL',
    priorite: biais === 'baissier' ? 'principale' : 'alternative',
    trigger: st.lastSwingLow ? `clôture sous ${num(st.lastSwingLow.price)}` : 'clôture sous le dernier creux',
    context: contexteVente,
    objectifProche: liqBas ? `${liqBas.type} à ${ou(liqBas.price, true)}` : null,
    ...levelsFor(report, 'SELL')
  };

  return { bullish: acheteur, bearish: vendeur, biais, raisonBiais };
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

/** Unités de temps connues (les sources les acceptent toutes). */
const TF_VALIDES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

/**
 * Profils de style : chaque façon de trader regarde des unités de temps
 * différentes. Un scalpeur travaille en 1m/5m, un suiveur de tendance en
 * 1h/4h. C'est la stratégie qui décide, pas l'application.
 */
const STYLES = {
  scalping: { label: 'Scalping', timeframes: ['1m', '5m', '15m'], seuilAlignes: 2, atrStop: 1 },
  intraday: { label: 'Intraday', timeframes: ['5m', '15m', '1h'], seuilAlignes: 2, atrStop: 1.5 },
  swing: { label: 'Swing', timeframes: ['1h', '4h', '1d'], seuilAlignes: 2, atrStop: 2 }
};

/** Réglages par défaut d'un moteur d'analyse (valeurs éprouvées). */
const MOTEUR_DEFAUT = {
  regles: ['R1', 'R2', 'R3', 'R4'],
  seuilForce: 0.35,
  seuilRegles: 2,
  style: null,
  timeframes: null,          // null = déduits du style ou de l'unité de travail
  seuilAlignes: null,        // null = majorité des unités examinées
  swingsWindow: 2,
  toleranceLiquidite: 0.0008,
  impulsion: 3,
  atrStop: 1.5
};

/** Borne une valeur, avec repli si elle est absurde. Un réglage hors bornes
 *  ne doit jamais faire planter une analyse : il est ramené dans le domaine. */
function borner(v, min, max, defaut) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.min(Math.max(x, min), max) : defaut;
}

/** Nettoie un moteur reçu du client : aucune valeur de confiance n'est gardée telle quelle. */
function normaliserMoteur(m = {}) {
  const brutes = Array.isArray(m.regles) ? m.regles.filter(r => TOUTES_REGLES[r]) : [];
  // Style de trading : il fixe les unités de temps par défaut.
  const style = (m.style && STYLES[m.style]) ? m.style : null;
  const dStyle = style ? STYLES[style] : null;

  // Unités de temps propres à la stratégie. Si elle n'en déclare pas, on prend
  // celles de son style, sinon l'analyse retombera sur l'unité de travail.
  let tf = Array.isArray(m.timeframes) ? m.timeframes.filter(t => TF_VALIDES.includes(t)) : [];
  if (!tf.length && dStyle) tf = [...dStyle.timeframes];
  tf = [...new Set(tf)].slice(0, 5);

  // Combien d'unités doivent être d'accord pour valider (jamais plus que le
  // nombre d'unités examinées, sinon la confirmation serait impossible).
  const seuilAlignes = tf.length
    ? Math.round(borner(m.seuilAlignes, 1, tf.length,
      (dStyle && dStyle.seuilAlignes) || Math.ceil(tf.length / 2)))
    : null;

  return {
    regles: brutes.length ? [...new Set(brutes)] : [],
    seuilForce: borner(m.seuilForce, 0, 1, MOTEUR_DEFAUT.seuilForce),
    seuilRegles: Math.round(borner(m.seuilRegles, 1, 4, MOTEUR_DEFAUT.seuilRegles)),
    style,
    timeframes: tf.length ? tf : null,
    seuilAlignes,
    swingsWindow: Math.round(borner(m.swingsWindow, 1, 5, MOTEUR_DEFAUT.swingsWindow)),
    toleranceLiquidite: borner(m.toleranceLiquidite, 0.0001, 0.01, MOTEUR_DEFAUT.toleranceLiquidite),
    impulsion: Math.round(borner(m.impulsion, 1, 6, MOTEUR_DEFAUT.impulsion)),
    atrStop: borner(m.atrStop, 0.5, 5, (dStyle && dStyle.atrStop) || MOTEUR_DEFAUT.atrStop)
  };
}

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
  // Un moteur défini explicitement prime sur toute déduction : l'utilisateur a
  // écrit comment sa stratégie fonctionne, on l'applique tel quel (borné).
  if (doc.moteur && typeof doc.moteur === 'object') {
    const m = normaliserMoteur(doc.moteur);
    const regles = m.regles.length ? m.regles : Object.keys(TOUTES_REGLES);
    return {
      id: doc.id || null,
      titre: doc.title || null,
      regles,
      seuilForce: m.seuilForce,
      seuilRegles: m.seuilRegles,
      // La stratégie décide de SON nombre d'unités de temps et du seuil
      // d'alignement : une stratégie de scalping n'exige pas les mêmes que
      // celles d'un suivi de tendance.
      style: m.style,
      timeframes: m.timeframes,
      seuilAlignes: m.seuilAlignes,
      parametres: {
        swingsWindow: m.swingsWindow,
        toleranceLiquidite: m.toleranceLiquidite,
        impulsion: m.impulsion,
        atrStop: m.atrStop
      },
      deduitDuTexte: false,
      motif: 'moteur défini explicitement'
    };
  }

  const texte = sansAccents(`${doc.title || ''} ${doc.content || ''} ${(doc.tags || []).join(' ')}`);
  const trouvees = [...new Set(MOTIFS_REGLE.filter(m => m.motifs.test(texte)).flatMap(m => m.regles))];
  const tous = Object.keys(TOUTES_REGLES);
  const regles = trouvees.length ? trouvees : tous;

  // Style déduit du texte : c'est lui qui décide des unités de temps à croiser
  // et de la largeur du stop. Une stratégie « scalping » ne se juge pas en 4 h.
  const style = /scalp|1 ?min|\bm1\b|tres court|court terme|rapide/.test(texte) ? 'scalping'
    : /swing|long terme|journalier|daily|\bh4\b|4 ?h/.test(texte) ? 'swing'
      : /intraday|journee|day ?trading|\bh1\b|1 ?h/.test(texte) ? 'intraday' : null;
  const dStyle = style ? STYLES[style] : null;

  return {
    id: doc.id || null,
    titre: doc.title || null,
    regles,
    seuilRegles: regles.length >= 2 ? 2 : 1,
    seuilForce: regles.length >= 2 ? 0.35 : 0.6,
    style,
    timeframes: dStyle ? dStyle.timeframes : null,
    seuilAlignes: dStyle ? dStyle.seuilAlignes : null,
    parametres: dStyle ? { atrStop: dStyle.atrStop } : undefined,
    deduitDuTexte: trouvees.length > 0,
    motif: trouvees.length
      ? `règles déduites du texte${style ? ` · style ${dStyle.label}` : ''}`
      : `texte sans indication : toutes les règles appliquées${style ? ` · style ${dStyle.label}` : ''}`
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

  const report = S.analyze(clean, meta, options.parametres || {});

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

  const sc = scenarios(report, options.parametres && options.parametres.atrStop);
  const chk = checklist(report);
  // Niveaux « du jour » : ceux du sens détecté, sinon les deux scénarios restent
  // consultables (on ne cache plus l'information sous prétexte d'incertitude).
  const levels = status === 'neutre'
    ? { entry: null, stop: null, target1: null, target2: null }
    : levelsFor(report, direction, options.parametres && options.parametres.atrStop);
  const fmt = v => (v === null || v === undefined ? '—' : v);

  const entete = options.strategie && options.strategie.titre
    ? `[${options.strategie.titre}] ` : '';
  const summary = status === 'neutre'
    ? `${entete}Aucun signal confirmé : ${missing.join(' ; ') || 'conditions insuffisantes'}.`
      + ` Biais ${sc.biais} (${sc.raisonBiais}).`
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
    // Biais d'ensemble et sa justification : quel scénario est privilégié, et
    // pourquoi. Sans ça, les deux scénarios auraient toujours le même poids.
    biais: sc.biais,
    raisonBiais: sc.raisonBiais,
    strategie: options.strategie || null,
    context: {
      trend: report.structure.trend,
      event: report.structure.event,
      position: report.premiumDiscount ? report.premiumDiscount.position : null,
      atr14: report.atr14
    }
  };
}

/**
 * Unités de temps à examiner ensemble pour un alignement. On regarde toujours
 * l'unité de travail, puis deux unités supérieures : c'est le contexte qui
 * décide si un signal local mérite d'être pris.
 */
const TF_SUPERIEURS = {
  '1m': ['1m', '5m', '15m'],
  '5m': ['5m', '15m', '1h'],
  '15m': ['15m', '1h', '4h'],
  '30m': ['30m', '1h', '4h'],
  '1h': ['1h', '4h', '1d'],
  '4h': ['4h', '1d'],
  '1d': ['1d']
};

/**
 * Alignement multi-timeframes (« confluence »).
 *
 * Un signal confirmé sur une seule unité de temps n'est pas un signal : c'est du
 * bruit. Ici on compare les verdicts de plusieurs unités et on refuse de
 * confirmer tant qu'elles ne racontent pas la même histoire.
 *
 * @param {Array<{tf:string, verdict:object}>} parTF du plus petit au plus grand
 * @param {{seuilAlignes?:number, exigerConfirmation?:boolean}} [options]
 */
function confluence(parTF, options = {}) {
  const listes = (parTF || []).filter(x => x && x.tf && x.verdict);
  if (!listes.length) {
    return { aligne: false, score: 0, direction: 'NEUTRE', detail: [], motif: 'aucune donnée' };
  }

  const seuil = Number.isFinite(options.seuilAlignes) ? options.seuilAlignes
    : Math.max(1, Math.ceil(listes.length / 2));

  const achats = listes.filter(x => x.verdict.direction === 'BUY');
  const ventes = listes.filter(x => x.verdict.direction === 'SELL');

  // La direction vient de l'unité de TRAVAIL (la plus petite, celle sur laquelle
  // on agirait). Une première version prenait la majorité : elle pouvait annoncer
  // « VENTE » alors que l'unité de travail disait ACHAT — un signal incohérent
  // avec le graphique qu'on a sous les yeux. Les unités supérieures confirment ou
  // infirment, elles ne renversent pas la décision.
  const travail = listes[0];
  const dirTravail = travail.verdict.direction && travail.verdict.direction !== 'NEUTRE'
    ? travail.verdict.direction : null;
  const direction = dirTravail
    || (achats.length > ventes.length ? 'BUY' : ventes.length > achats.length ? 'SELL' : 'NEUTRE');

  const alignes = direction === 'NEUTRE' ? [] : listes.filter(x => x.verdict.direction === direction);
  const contraires = listes.filter(x => x.verdict.direction && x.verdict.direction !== direction);
  const confirmees = alignes.filter(x => x.verdict.status === 'confirme');
  const superieure = listes[listes.length - 1];    // le contexte large

  const tendances = listes.map(x => x.verdict.trend).filter(Boolean);
  const nbBull = tendances.filter(t => t === 'bullish').length;
  const nbBear = tendances.filter(t => t === 'bearish').length;
  const tendanceDominante = nbBull === nbBear ? 'range' : (nbBull > nbBear ? 'bullish' : 'bearish');

  // Deux exigences pour « aligné » : assez d'unités d'accord ET l'unité de
  // travail ne doit pas contredire le contexte supérieur.
  const coherentAvecContexte = !superieure || superieure.verdict.trend === 'range'
    || superieure.verdict.trend === tendanceDominante
    || (direction === 'BUY' && superieure.verdict.trend === 'bullish')
    || (direction === 'SELL' && superieure.verdict.trend === 'bearish');
  const aligne = alignes.length >= seuil && direction !== 'NEUTRE' && coherentAvecContexte;

  // Le signal du dessus doit lui aussi aller dans le bon sens, sinon c'est un
  // contre-tendance déguisé : on le dit franchement.
  const contreTendance = direction !== 'NEUTRE' && !coherentAvecContexte;

  return {
    aligne,
    contreTendance,
    score: +(alignes.length / listes.length).toFixed(3),
    direction,
    seuilAlignes: seuil,
    nbAlignes: alignes.length,
    nbContraires: contraires.length,
    nbConfirmees: confirmees.length,
    tendanceDominante,
    tendanceSuperieure: superieure ? superieure.verdict.trend : null,
    tfTravail: travail ? travail.tf : null,
    tfSuperieure: superieure ? superieure.tf : null,
    detail: listes.map(x => ({
      tf: x.tf,
      tendance: x.verdict.trend,
      status: x.verdict.status,
      direction: x.verdict.direction,
      strength: x.verdict.strength,
      confirme: x.verdict.status === 'confirme',
      regles: (x.verdict.rules || []).map(r => r.rule)
    })),
    motif: direction === 'NEUTRE'
      ? 'aucune direction ne se dégage sur les unités de temps'
      : contreTendance
        ? `signal ${direction === 'BUY' ? 'acheteur' : 'vendeur'} mais contexte ${superieure ? superieure.tf : ''} ${superieure ? superieure.verdict.trend : ''} : contre-tendance`
        : aligne
          ? `${alignes.length}/${listes.length} unités d'accord sur ${direction === 'BUY' ? 'l\'achat' : 'la vente'} (seuil ${seuil})`
          : `seulement ${alignes.length}/${listes.length} unité(s) d'accord : il en faut ${seuil}`
  };
}

/**
 * Verdict final : le signal de l'unité de travail, mais confirmé SEULEMENT si
 * l'alignement multi-timeframes le permet. C'est ce qui évite de valider un
 * signal isolé qui va se retourner.
 */
function verdictAvecConfluence(parTF, options = {}) {
  const conf = confluence(parTF, options);
  const base = parTF && parTF[0] ? parTF[0].verdict : null;
  if (!base) return { verdict: null, confluence: conf };

  const v = { ...base };
  v.confluence = conf;
  if (!conf.aligne && v.status === 'confirme' && options.exigerAlignement !== false) {
    v.status = 'surveiller';
    v.alignementManquant = true;
    v.summary = `Alignement insuffisant — ${conf.motif}. ` + v.summary;
  }
  return { verdict: v, confluence: conf };
}

module.exports = {
  detect, scenarios, checklist, levelsFor, profilDepuisStrategie, TOUTES_REGLES,
  confluence, verdictAvecConfluence, TF_SUPERIEURS, normaliserMoteur, STYLES, MOTEUR_DEFAUT,
  ruleSweep, ruleBreak, ruleZone, rulePosition
};
