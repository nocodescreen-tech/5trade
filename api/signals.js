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

/** Durée d'une bougie par unité de temps — sert à juger la fraîcheur des données. */
const TF_MS = {
  '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000,
  '1h': 3600000, '4h': 14400000, '1d': 86400000
};

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
        rule: 'R1', name: 'Sweep (balayage de liquidité)',  sigle: 'R1',
        direction: 'BUY', strength: +(Math.min(wick / range, 0.9)).toFixed(3),
        detail: `mèche sous ${lv.kind} ${num(lv.price)} puis clôture au-dessus (${num(last.c)})`,
        level: num(lv.price),
        // Empreinte de la PREUVE : le niveau reellement balaye. Deux regles
        // qui lisent ce meme niveau decrivent UN SEUL evenement du marche —
        // les compter separement gonflait la force du signal.
        preuve: `niveau:${num(lv.price)}`, source: lv.kind
      };
    }
    // Balayage baissier : on perce AU-DESSUS, puis on clôture EN DESSOUS.
    if (last.h > lv.price && last.c < lv.price) {
      const wick = last.h - Math.max(last.o, last.c);
      const range = Math.max(last.h - last.l, 1e-9);
      return {
        rule: 'R1', name: 'Sweep (balayage de liquidité)',  sigle: 'R1',
        direction: 'SELL', strength: +(Math.min(wick / range, 0.9)).toFixed(3),
        detail: `mèche au-dessus de ${lv.kind} ${num(lv.price)} puis clôture en dessous (${num(last.c)})`,
        level: num(lv.price),
        // Empreinte de la PREUVE : le niveau reellement balaye. Deux regles
        // qui lisent ce meme niveau decrivent UN SEUL evenement du marche —
        // les compter separement gonflait la force du signal.
        preuve: `niveau:${num(lv.price)}`, source: lv.kind
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
    rule: 'R2', name: e.type === 'CHoCH' ? 'CHoCH (changement de caractère)' : 'BOS (rupture de structure)',
    direction: e.direction === 'bullish' ? 'BUY' : 'SELL',
    strength: +Math.min(base + pierce * 0.2, 0.95).toFixed(3),
    detail: `clôture ${num(last.c)} au-delà du niveau ${num(e.level)}`,
    level: num(e.level),
    // Meme niveau que R1 s'il s'agit du meme mouvement : la cassure EST souvent le
    // balayage. L'empreinte identique empeche de compter deux fois.
    preuve: `niveau:${num(e.level)}`, source: e.type
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
          rule: 'R3', name: `Rejet sur ${z.kind} haussier (OB/FVG)`, direction: 'BUY', strength,
          detail: `zone ${num(z.low)}–${num(z.high)} touchée puis clôture au-dessus (prix en ${where})`,
          level: num(z.high),
          // La preuve est la zone touchee, pas son bord : deux lectures de
          // la meme zone restent un seul evenement.
          preuve: `zone:${num(z.low)}-${num(z.high)}`, source: z.kind
        };
      }
      // Piège : zone de demande prise par le haut, puis cédée → vente.
      if (last.c < z.low && position === 'premium') {
        return {
          rule: 'R3', name: `Échec de ${z.kind} haussier en premium (OB/FVG)`, direction: 'SELL', strength,
          detail: `zone ${num(z.low)}–${num(z.high)} atteinte en premium puis cassée vers le bas`,
          level: num(z.low),
          // La preuve est la zone touchee, pas son bord : deux lectures de
          // la meme zone restent un seul evenement.
          preuve: `zone:${num(z.low)}-${num(z.high)}`, source: z.kind
        };
      }
    }

    if (z.type === 'bearish') {
      // Zone d'offre : vente seulement si le prix vient d'en haut.
      if (last.c < z.low && position !== 'discount') {
        return {
          rule: 'R3', name: `Rejet sur ${z.kind} baissier (OB/FVG)`, direction: 'SELL', strength,
          detail: `zone ${num(z.low)}–${num(z.high)} touchée puis clôture en dessous (prix en ${where})`,
          level: num(z.low),
          // La preuve est la zone touchee, pas son bord : deux lectures de
          // la meme zone restent un seul evenement.
          preuve: `zone:${num(z.low)}-${num(z.high)}`, source: z.kind
        };
      }
      if (last.c > z.high && position === 'discount') {
        return {
          rule: 'R3', name: `Échec de ${z.kind} baissier en discount (OB/FVG)`, direction: 'BUY', strength,
          detail: `zone ${num(z.low)}–${num(z.high)} atteinte en discount puis cassée vers le haut`,
          level: num(z.high),
          // La preuve est la zone touchee, pas son bord : deux lectures de
          // la meme zone restent un seul evenement.
          preuve: `zone:${num(z.low)}-${num(z.high)}`, source: z.kind
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
      rule: 'R4', name: 'Discount (zone basse du range)',
      direction: 'BUY', strength: 0.4,
      detail: `prix ${num(report.lastPrice)} sous l'équilibre ${num(pd.equilibrium)}`,
      level: num(pd.equilibrium),
      // La preuve est le range lui-meme : premium et discount decrivent la
      // meme observation, vue d'un cote ou de l'autre.
      preuve: `range:${num(pd.low)}-${num(pd.high)}`, source: 'position dans le range'
    };
  }
  if (pd.position === 'premium' && trend !== 'bullish') {
    return {
      rule: 'R4', name: 'Premium (zone haute du range)',
      direction: 'SELL', strength: 0.4,
      detail: `prix ${num(report.lastPrice)} au-dessus de l'équilibre ${num(pd.equilibrium)}`,
      level: num(pd.equilibrium),
      // La preuve est le range lui-meme : premium et discount decrivent la
      // meme observation, vue d'un cote ou de l'autre.
      preuve: `range:${num(pd.low)}-${num(pd.high)}`, source: 'position dans le range'
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

  // DISTANCE MINIMALE D'UNE CIBLE.
  // Avant : seules les valeurs « au-dessus du prix » étaient retenues, puis on
  // prenait la plus proche. Conséquence réelle observée : entrée 83 533.46 et
  // objectif 1 à 83 534.11 — soit 0,65 point de gain pour 139 points de risque.
  // Pire : le dernier sommet servait à la fois de déclencheur (à franchir) et
  // d'objectif (à atteindre), donc le moteur annonçait un objectif déjà atteint
  // dès l'entrée. Une cible à moins d'un ATR ne paie pas le risque : elle est
  // écartée, et on retombe alors sur une cible construite à partir de l'ATR.
  const margeMini = atr;

  if (direction === 'BUY') {
    const structural = low && Number.isFinite(low.price) ? low.price : price - atr * k;
    const stop = Math.min(structural, price - atr * 0.5);         // jamais trop près
    // Le déclencheur d'un achat est « clôture au-dessus du dernier sommet » : ce
    // niveau est un SEUIL À FRANCHIR, pas une destination. Les objectifs se
    // situent donc au-delà, jamais dessus — sinon la cible est déjà atteinte au
    // moment où l'on entre.
    const seuil = (high && Number.isFinite(high.price)) ? high.price : price;
    const plancher = Math.max(price + margeMini, seuil);
    const targets = [
      report.structure.lastSwingHigh && report.structure.lastSwingHigh.price,
      ...(report.liquidity || []).filter(p => p.price > price).map(p => p.price)
    ].filter(p => Number.isFinite(p) && p > plancher).sort((a, b) => a - b);
    return {
      entry: num(price), stop: num(stop),
      target1: num(targets[0] || price + atr * 2),
      target2: num(targets[1] || price + atr * 3)
    };
  }
  if (direction === 'SELL') {
    const structural = high && Number.isFinite(high.price) ? high.price : price + atr * k;
    const stop = Math.max(structural, price + atr * 0.5);
    // Symétrique : le déclencheur d'une vente est la clôture sous le dernier
    // creux, donc les objectifs sont en dessous de ce seuil.
    const seuil = (low && Number.isFinite(low.price)) ? low.price : price;
    const plafond = Math.min(price - margeMini, seuil);
    const targets = [
      report.structure.lastSwingLow && report.structure.lastSwingLow.price,
      ...(report.liquidity || []).filter(p => p.price < price).map(p => p.price)
    ].filter(p => Number.isFinite(p) && p < plafond).sort((a, b) => b - a);
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
  // Deux décimales, pas une : 2,33 de distance pour un ATR de 52,17 vaut 0,0447,
  // que l'arrondi à une décimale affichait « 0.0× ATR ». Une distance faible mais
  // réelle était donc présentée comme nulle — l'utilisateur ne pouvait pas
  // distinguer « collé au prix » de « pas de donnée ».
  const distAtr = n => (Number.isFinite(n) ? +(Math.abs(n - prix) / atr).toFixed(2) : null);
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
    { key: 'tendance', label: 'HH-HL / LH-LL — tendance définie', ok: st.trend !== 'range', detail: st.trend },
    { key: 'rupture', label: 'BOS / CHoCH — rupture de structure (clôture)', ok: !!st.event,
      detail: st.event ? `${st.event.type} ${st.event.direction} à ${num(st.event.level)}` : 'aucune cassure de clôture' },
    { key: 'liquidite', label: 'Sweep — liquidité prise (EQH/EQL)', ok: (report.liquidity || []).length > 0,
      detail: (report.liquidity || []).map(p => `${p.type} ${num(p.price)}`).join(', ') || 'aucun pool de liquidité' },
    { key: 'zone', label: 'OB / FVG — zone réactive', ok: zones.length > 0,
      detail: zones.length ? `${zones.length} zone(s) ouverte(s)` : 'aucune zone valide' },
    { key: 'position', label: 'Premium / Discount — position dans le range', ok: !!pd && pd.position !== null,
      detail: pd ? `${pd.position} (équilibre ${num(pd.equilibrium)})` : 'range indéterminé' }
  ];
}

/**
 * R5 — Sens de la structure : RETIRÉE DU VOTE (conservée comme documentation).
 *
 * Elle disait : « la structure est haussière, donc un achat est favorisé ».
 * C'est une TAUTOLOGIE, pas une observation : elle ne lisait rien sur le
 * graphique et redisait le sens du signal. La compter comme confirmation revenait
 * à confirmer un achat par le fait qu'on est haussier — et, depuis le passage aux
 * empreintes de preuve, elle pouvait à elle seule fournir la deuxième
 * « confirmation » du seuil.
 *
 * La structure reste exposée dans le verdict, mais dans `context` : elle sert à
 * LIRE le signal (va-t-il dans le sens de la structure, ou contre elle ?), et
 * `context.confirme` vaut false pour que personne ne s'y trompe.
 */


/**
 * Filtres — les conditions qui ne votent pas mais qui bloquent.
 *
 * Un critère comme « la volatilité est suffisante » n'a pas de sens : il ne dit
 * ni achat ni vente. Mais s'il est faux, le signal n'a rien à payer en frais.
 * Ces filtres sont donc exigibles par une stratégie, et leur échec interdit la
 * confirmation sans toucher au vote des règles.
 */
function filtresDisponibles(report) {
  const pd = report.premiumDiscount || {};
  const se = report.sessions || {};
  const atr = report.atr14, prix = report.lastPrice;
  const atrPct = (Number.isFinite(atr) && Number.isFinite(prix) && prix) ? atr / prix : 0;
  const deplacements = (report.displacements || []).length;
  const sessionActive = /londres|new ?york|overlap/i.test(String(se.sessionCourante || ''));
  const killZone = se.killZone && se.killZone !== 'aucune en ce moment';

  return [
    {
      cle: 'volatilite', label: 'Volatilité exploitable',
      ok: atrPct >= 0.0005 || deplacements > 0,
      detail: `ATR ${(atrPct * 100).toFixed(3)} % du prix · ${deplacements} déplacement(s)`,
      lecture: 'sans amplitude, un signal ne couvre pas ses frais'
    },
    {
      cle: 'session', label: 'Session active (liquidité)',
      ok: sessionActive || !!killZone,
      detail: `${se.sessionCourante || '—'}${killZone ? ' · ' + se.killZone : ''}`,
      lecture: 'les mouvements les plus francs arrivent sur Londres et New York'
    },
    {
      cle: 'range', label: 'Range défini (bornes nettes)',
      ok: Number.isFinite(pd.high) && Number.isFinite(pd.low) && Number.isFinite(pd.equilibrium)
        && pd.high > pd.low,
      detail: pd.high ? `${pd.low} / ${pd.equilibrium} / ${pd.high}` : 'range indéterminé',
      lecture: 'premium/discount n\'a de sens que si le range est identifié'
    }
  ];
}

/**
 * Les règles qui VOTENT. Elles décrivent chacune une observation du marché.
 *
 * R5 (« la structure est haussière, donc un achat est favorisé ») n'y figure
 * plus. C'était une TAUTOLOGIE : elle ne lisait rien sur le graphique et
 * redisait le sens du signal. La compter comme confirmation revenait à confirmer
 * un achat par le fait qu'on est haussier. Ce n'est pas une observation, donc ça
 * ne vote pas — la structure reste exposée comme CONTEXTE (affichée, expliquée),
 * mais elle ne peut plus atteindre le seuil de confirmation à elle seule.
 */
const TOUTES_REGLES = {
  R1: (candles, report) => ruleSweep(candles, report),
  R2: (candles, report) => ruleBreak(candles, report),
  R3: (candles, report) => ruleZone(candles, report),
  R4: (candles, report) => rulePosition(report)
};

/** Ce que chaque règle veut dire, pour l'interface et les messages. */
const REGLES_INFO = {
  R1: 'Balayage de liquidité',
  R2: 'Rupture de structure (BOS / CHoCH)',
  R3: 'Zone réactive (order block / FVG)',
  R4: 'Position dans le range (premium / discount)',
  R5: 'Sens de la structure (contexte : ne vote pas)'
};

const sansAccents = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Identifiants des filtres exigibles par une stratégie (voir filtresDisponibles). */
const CLES_FILTRES = ['volatilite', 'session', 'range'];

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
    // Le nombre de règles disponibles n'est pas fixe : une stratégie peut croiser
    // 1, 2, 3… critères. Le seuil suit le nombre réel de règles du moteur.
    seuilRegles: Math.round(borner(m.seuilRegles, 1,
      Object.keys(TOUTES_REGLES).length, MOTEUR_DEFAUT.seuilRegles)),
    // Filtres exigés : des conditions qui ne votent pas mais qui bloquent.
    filtres: Array.isArray(m.filtres)
      ? [...new Set(m.filtres.filter(f => CLES_FILTRES.includes(f)))].slice(0, 5) : [],
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
      // Filtres exigés par la stratégie (volatilité, session, range).
      filtres: Array.isArray(m.filtres) ? m.filtres : [],
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
    // Un style suppose aussi des exigences : un scalpeur a besoin de volatilité
    // et d'une session active, un suivi de tendance non.
    filtres: style === 'scalping' ? ['volatilite', 'session']
      : style === 'intraday' ? ['volatilite'] : [],
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

  // ── LES CONFIRMATIONS COMPTENT DES PREUVES, PAS DES NOMS DE RÈGLES ──
  // Avant : `new Set(winner.map(r => r.rule)).size` comptait des IDENTIFIANTS.
  // Trois règles différentes valaient donc trois observations indépendantes.
  // Or R1 (balayage) et R2 (cassure) lisent souvent LE MÊME niveau sur LA MÊME
  // bougie : le balayage EST la rupture. C'est un seul événement du marché compté
  // deux fois, et la force du signal s'en trouvait gonflée sans qu'aucun fait
  // nouveau soit apparu. Chaque règle porte désormais une empreinte de sa preuve
  // (le niveau lu, la zone touchée, le range, la structure) : le comptage
  // regroupe par empreinte.
  const clePreuve = r => r.preuve || `regle:${r.rule}`;
  const preuves = new Set(winner.map(clePreuve));
  const independent = preuves.size;
  // Regroupement lisible : quelles règles décrivent la même preuve.
  const preuvesDetail = {};
  for (const r of winner) {
    const cle = clePreuve(r);
    (preuvesDetail[cle] = preuvesDetail[cle] || []).push({ rule: r.rule, name: r.name, source: r.source || null });
  }
  const preuvesPartagees = Object.entries(preuvesDetail)
    .filter(([, regles]) => regles.length > 1)
    .map(([cle, regles]) => ({ preuve: cle, regles: regles.map(x => x.rule), lecture: regles.map(x => x.rule).join(' + ') + ' décrivent la même observation' }));

  // ── Lire les règles sans ambiguïté ──
  // L'écran affichait « reglesActives: 5 » face à « confirmations: 3 », ce qui
  // était illisible : on ne savait pas si les 2 autres manquaient, s'opposaient
  // ou n'avaient simplement rien à dire. Chaque règle interrogée finit donc dans
  // une catégorie explicite.
  const reglesEvaluees = actives;
  const reglesPour = rules.filter(r => r.direction === direction).map(r => r.rule);
  const reglesContre = rules
    .filter(r => (r.direction === 'BUY' || r.direction === 'SELL') && r.direction !== direction)
    .map(r => r.rule);
  const reglesNeutres = rules.filter(r => r.direction !== 'BUY' && r.direction !== 'SELL').map(r => r.rule);
  // Une règle évaluée qui n'a produit AUCUN avis : elle n'a rien trouvé sur ce
  // graphique (pas « elle est satisfaite », ni « elle s'y oppose »).
  const reglesMuettes = actives.filter(r => !rules.some(x => x.rule === r));

  // CONTRADICTION : des règles qui tirent en sens opposés. C'est le cas piégeux —
  // une moyenne masquerait le désaccord et produirait une confirmation qui ne
  // repose sur rien. Deux règles qui se contredisent ne sont pas une confirmation.
  //   • désaccord simple  : les deux camps existent, un domine nettement
  //   • désaccord franc   : les deux camps sont à égalité (1 contre 1, 2 contre 2)
  const contradictionActive = buy.length > 0 && sell.length > 0;
  const desaccordFranc = contradictionActive && Math.abs(buy.length - sell.length) <= 1;

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
  // Un désaccord franc interdit la confirmation, quelle que soit la force.
  // FILTRES exigés par la stratégie : ce ne sont pas des avis directionnels, donc
  // ils ne votent pas — mais s'ils ne sont pas remplis, la confirmation est
  // interdite. C'est ainsi qu'une stratégie dit « il me faut de la volatilité et
  // une session active » sans déformer le vote des règles.
  const tousFiltres = filtresDisponibles(report);
  const filtresExiges = Array.isArray(options.filtres) ? options.filtres : [];
  const filtresKO = tousFiltres.filter(f => filtresExiges.includes(f.cle) && !f.ok);

  // ── État du marché, à ne pas confondre avec la session de la stratégie ──
  // Quatre choses différentes étaient mélangées sous « session » :
  //   • le marché est-il ouvert ? (un crypto s'échange 24 h/24 ; un indice non)
  //   • la session préférée de la stratégie est-elle active ?
  //   • les données sont-elles fraîches ?
  //   • la volatilité est-elle suffisante ?
  // Une session inactive NE bloque pas : seuls les filtres réellement exigés par
  // la stratégie bloquent. On expose donc l'état, sans décider à sa place.
  const symbole = String(meta.symbol || '');
  const crypto = /USDT$|USDC$|USDT$/i.test(symbole) || /^(BTC|ETH|SOL|XRP)/i.test(symbole);
  const se2 = report.sessions || {};
  const sessionActive2 = /londres|new ?york|overlap/i.test(String(se2.sessionCourante || ''));
  const ageBougie = Number.isFinite(report.atr14) && clean.length
    ? Date.now() - clean[clean.length - 1].t : null;
  const dureeTf = TF_MS[meta.timeframe] || null;
  const donneesFraiches = dureeTf ? (ageBougie !== null && ageBougie < dureeTf * 3) : null;
  const etatMarche = {
    marche: crypto ? 'ouvert en continu (crypto)' : 'horaires de séance',
    ouvert: crypto ? true : (sessionActive2 || !!se2.killZone),
    session: se2.sessionCourante || 'inconnue',
    sessionExigee: filtresExiges.includes('session'),
    donneesFraiches,
    ageDerniereBougieMin: ageBougie !== null ? +(ageBougie / 60000).toFixed(1) : null,
    volatiliteSuffisante: (tousFiltres.find(f => f.cle === 'volatilite') || {}).ok ?? null,
    // Ce qui bloque réellement (vide = rien ne bloque).
    bloque: filtresKO.map(f => f.label),
    lecture: filtresKO.length
      ? `bloqué par : ${filtresKO.map(f => f.label).join(', ')}`
      : crypto
        ? 'marché ouvert en continu : aucune restriction de séance'
        : sessionActive2
          ? `séance ${se2.sessionCourante} en cours`
          : 'hors séance, mais aucune stratégie n\'exige de session : rien n\'est bloqué'
  };

  const seuilRegles = Number.isFinite(options.seuilRegles) ? options.seuilRegles : 2;
  const seuilForce = Number.isFinite(options.seuilForce) ? options.seuilForce : 0.35;
  const seuilSurveiller = Math.max(0.3, seuilForce - 0.05);
  const status = (!desaccordFranc && !filtresKO.length
    && independent >= seuilRegles && strength >= seuilForce) ? 'confirme'
    : (independent >= 1 && strength >= seuilSurveiller) ? 'surveiller' : 'neutre';

  // Ce que chaque camp avance, pour que le désaccord soit lisible.
  const camp = r => ({ rule: r.rule, name: r.name, direction: r.direction, strength: r.strength });
  const contradiction = {
    active: contradictionActive,
    franche: desaccordFranc,
    pour: winner.map(camp),
    contre: loser.map(camp),
    lecture: !contradictionActive
      ? 'les règles vont dans le même sens'
      : desaccordFranc
        ? `Désaccord : ${buy.length} règle(s) haussière(s) contre ${sell.length} baissière(s) — aucune confirmation possible`
        : `${loser.length} règle(s) ${loser[0].direction === 'BUY' ? 'haussière(s)' : 'baissière(s)'} contredisent la direction retenue (pénalité de force appliquée)`
  };

  // Pourquoi ce n'est pas confirmé : on l'écrit au lieu de laisser deviner.
  const missing = [];
  if (status !== 'confirme') {
    if (desaccordFranc) missing.push(contradiction.lecture);
    for (const f of filtresKO) missing.push(`filtre non rempli — ${f.label} : ${f.detail}`);
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
      // On annonce des PREUVES distinctes, pas des noms de regles : deux regles
      // qui lisent le meme niveau ne confirment qu'une seule fois.
      + ` — ${independent} preuve(s) distincte(s) : ${winner.map(r => r.name).join(' + ')}`
      + ` (sur ${reglesEvaluees.length} règle(s) évaluée(s))`
      + (preuvesPartagees.length
        ? ` · ${preuvesPartagees.map(pp => pp.lecture).join(' ; ')}` : '')
      + (contradiction.franche ? ` · DÉSACCORD : ${contradiction.lecture}`
        : (contradiction.active ? ` · ${contradiction.lecture}` : ''))
      + ` · force ${(strength * 100).toFixed(0)} %`
      + ` · entrée ${fmt(levels.entry)} / invalidation ${fmt(levels.stop)} / objectifs ${fmt(levels.target1)} puis ${fmt(levels.target2)}`;

  return {
    at: clean[clean.length - 1].t,
    symbol: meta.symbol || null,
    timeframe: meta.timeframe || null,
    status, direction, strength,
    confirmations: independent,
    // Les regles, rangees par categorie : ce qui appuie, ce qui s'oppose, ce qui
    // est neutre, et ce qui n'a rien trouve. Sans ca, « 5 evaluees / 3 d'accord »
    // laissait l'utilisateur deviner ce que faisaient les deux autres.
    reglesEvaluees, reglesPour, reglesContre, reglesNeutres, reglesMuettes,
    // Preuves : combien d'observations DISTINCTES, et quelles regles se
    // partagent la meme. C'est ce qui empeche un meme fait de compter double.
    preuves: preuvesDetail, preuvesPartagees,
    rules,
    levels,
    scenarios: sc,
    checklist: chk,
    missing,
    price: report.lastPrice,
    // L'ATR est exposé : sans lui, impossible de vérifier soi-même les distances
    // annoncées en « × ATR » ni la cohérence des objectifs.
    atr: Number.isFinite(report.atr14) ? +report.atr14.toFixed(6) : null,
    trend: report.structure.trend,
    summary,
    // Le désaccord entre règles est exposé tel quel : on ne masque pas un
    // « 1 pour / 1 contre » derrière une direction choisie arbitrairement.
    contradiction,
    // Filtres : ce que la stratégie exigeait, et ce que le marché en dit.
    filtres: tousFiltres,
    filtresExiges,
    // État du marché : ouvert/fermé, session, fraîcheur des données, volatilité.
    // Quatre notions distinctes, exposées séparément au lieu d'un mot « session »
    // qui laissait croire à un blocage.
    etatMarche,
    // Traçabilité : quelles règles ont été appliquées, et au nom de quoi.
    reglesActives: actives,
    seuils: { regles: seuilRegles, force: seuilForce },
    // Biais d'ensemble et sa justification : quel scénario est privilégié, et
    // pourquoi. Sans ça, les deux scénarios auraient toujours le même poids.
    biais: sc.biais,
    raisonBiais: sc.raisonBiais,
    strategie: options.strategie || null,
    // ── CONTEXTE (ne vote pas, ne confirme pas) ──
    // La structure de marché est exposée pour LIRE le signal — dit-elle s'il va
    // dans son sens ou contre elle — mais elle ne compte pas comme confirmation.
    // « La structure est haussière donc un achat est favorisé » ne lit rien de
    // plus sur le graphique : c'est le sens du signal répété. C'était une
    // tautologie, elle est désormais ici et non dans les règles qui votent.
    context: {
      trend: report.structure.trend,
      event: report.structure.event,
      position: report.premiumDiscount ? report.premiumDiscount.position : null,
      atr14: report.atr14,
      dernierSommet: report.structure.lastSwingHigh ? num(report.structure.lastSwingHigh.price) : null,
      dernierCreux: report.structure.lastSwingLow ? num(report.structure.lastSwingLow.price) : null,
      lecture: report.structure.trend === 'bullish'
        ? 'structure haussière : un achat va DANS son sens, une vente va CONTRE'
        : report.structure.trend === 'bearish'
          ? 'structure baissière : une vente va DANS son sens, un achat va CONTRE'
          : 'structure en range : ni sens ni contre-sens',
      // La structure informe, elle ne confirme pas.
      confirme: false
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

  // ── Ce qui compte comme un ACCORD ──
  // Avant, une unité « alignée » était simplement une unité dont la DIRECTION
  // valait la direction retenue. Or une unité en range peut porter une direction
  // (une règle de position, par exemple) sans rien confirmer du mouvement : elle
  // était donc comptée comme un accord, et l'écran pouvait annoncer « 3/3
  // unités d'accord » alors qu'AUCUNE ne confirmait quoi que ce soit.
  // On distingue désormais trois contributions :
  //   appui       → même direction ET tendance dans ce sens  (vraie confluence)
  //   appui faible→ même direction mais tendance indécise     (ne compte pas)
  //   contraire   → direction opposée
  const tendanceAttendue = direction === 'BUY' ? 'bullish' : direction === 'SELL' ? 'bearish' : null;
  // Un APPUI demande la même direction ET une raison de la croire :
  //   • soit la tendance va dans ce sens ;
  //   • soit le signal de cette unité est CONFIRMÉ par au moins deux règles
  //     indépendantes — un range où deux règles s'accordent n'est pas rien, et
  //     exiger une tendance même quand les règles parlent clairement serait
  //     excessif (c'est le reproche inverse de celui qu'on corrige).
  // Tout le reste qui pointe dans la même direction est un « appui faible » :
  // même direction, mais rien pour la confirmer.
  const confirmeParRegles = x => x.verdict.status === 'confirme'
    && (x.verdict.confirmations || 0) >= 2;
  const estAppui = x => x.verdict.direction === direction
    && (x.verdict.trend === tendanceAttendue || confirmeParRegles(x));
  const appuis = tendanceAttendue ? listes.filter(estAppui) : [];
  const appuisFaibles = tendanceAttendue
    ? listes.filter(x => x.verdict.direction === direction && !estAppui(x))
    : [];
  // Une unité sans direction (NEUTRE) n'est PAS une unité contraire : elle ne
  // s'oppose à rien, elle ne dit rien. La compter comme contraire gonflait
  // artificiellement l'opposition.
  const contraires = listes.filter(x =>
    (x.verdict.direction === 'BUY' || x.verdict.direction === 'SELL')
    && x.verdict.direction !== direction);
  const confirmees = appuis.filter(x => x.verdict.status === 'confirme');
  const superieure = listes[listes.length - 1];    // le contexte large

  const tendances = listes.map(x => x.verdict.trend).filter(Boolean);
  const nbBull = tendances.filter(t => t === 'bullish').length;
  const nbBear = tendances.filter(t => t === 'bearish').length;
  const tendanceDominante = nbBull === nbBear ? 'range' : (nbBull > nbBear ? 'bullish' : 'bearish');

  // Deux exigences pour « aligné » : assez d'unités qui APPUIENT réellement, et
  // l'unité de travail qui ne contredit pas le contexte supérieur.
  const coherentAvecContexte = !superieure || superieure.verdict.trend === 'range'
    || superieure.verdict.trend === tendanceDominante
    || (direction === 'BUY' && superieure.verdict.trend === 'bullish')
    || (direction === 'SELL' && superieure.verdict.trend === 'bearish');
  const aligne = appuis.length >= seuil && direction !== 'NEUTRE' && coherentAvecContexte;

  // Le signal du dessus doit lui aussi aller dans le bon sens, sinon c'est un
  // contre-tendance déguisé : on le dit franchement.
  const contreTendance = direction !== 'NEUTRE' && !coherentAvecContexte;

  return {
    aligne,
    contreTendance,
    // Le score est la part d'unités qui appuient RÉELLEMENT (direction ET
    // tendance), pas la part d'unités affichant la même direction.
    score: +(appuis.length / listes.length).toFixed(3),
    direction,
    seuilAlignes: seuil,
    nbAlignes: appuis.length,
    nbAppuisFaibles: appuisFaibles.length,
    nbContraires: contraires.length,
    nbConfirmees: confirmees.length,
    tendanceDominante,
    tendanceSuperieure: superieure ? superieure.verdict.trend : null,
    tfTravail: travail ? travail.tf : null,
    tfSuperieure: superieure ? superieure.tf : null,
    detail: listes.map(x => {
      const estAppui = appuis.includes(x);
      const estFaible = appuisFaibles.includes(x);
      const estContre = contraires.includes(x);
      return {
        tf: x.tf,
        tendance: x.verdict.trend,
        status: x.verdict.status,
        direction: x.verdict.direction,
        strength: x.verdict.strength,
        confirme: x.verdict.status === 'confirme',
        regles: (x.verdict.rules || []).map(r => r.rule),
        // Pourquoi cette unité pèse — ou ne pèse pas — dans le score global.
        contribution: estAppui ? 'appui' : estFaible ? 'appui faible' : estContre ? 'contraire' : 'sans direction',
        contribue: estAppui,
        raison: estAppui
          ? (x.verdict.trend === tendanceAttendue
            ? `tendance ${x.verdict.trend} et direction ${x.verdict.direction} : appuie`
            : `tendance indécise (${x.verdict.trend}) mais signal confirmé par ${x.verdict.confirmations} règles : appuie`)
          : estFaible
            ? `direction ${x.verdict.direction} mais rien pour la confirmer (tendance ${x.verdict.trend}, ${x.verdict.confirmations || 0} règle(s)) : ne compte pas`
            : estContre
              ? `direction ${x.verdict.direction} : contraire`
              : 'aucune direction exploitable'
      };
    }),
    motif: direction === 'NEUTRE'
      ? 'aucune direction ne se dégage sur les unités de temps'
      : contreTendance
        ? `signal ${direction === 'BUY' ? 'acheteur' : 'vendeur'} mais contexte ${superieure ? superieure.tf : ''} ${superieure ? superieure.verdict.trend : ''} : contre-tendance`
        : aligne
          ? `${appuis.length}/${listes.length} unités appuient ${direction === 'BUY' ? 'l\'achat' : 'la vente'} (seuil ${seuil})`
            + (appuisFaibles.length
              ? ` — ${appuisFaibles.length} affiche(nt) la même direction mais sans tendance : non comptée(s)`
              : '')
          : `${appuis.length}/${listes.length} unité(s) appuient réellement : il en faut ${seuil}`
            + (appuisFaibles.length
              ? ` — ${appuisFaibles.length} autre(s) affichent la même direction mais sans tendance`
              : '')
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
  filtresDisponibles, CLES_FILTRES, REGLES_INFO,
  ruleSweep, ruleBreak, ruleZone, rulePosition
};
