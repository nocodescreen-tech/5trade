/**
 * 5trade — MOTIFS DE BOUGIES ET DE GRAPHIQUE (mesures pures).
 *
 * Pourquoi ce module existe : le moteur ne connaissait QUE les règles de structure
 * (balayage, BOS, zone, premium/discount). Or un graphique porte en même temps un
 * doji, un marteau, un double bottom, une trendline cassée — chacun avec SON sens
 * et SA lecture. Les fondre dans un verdict unique efface l'information.
 *
 * Doctrine (celle du reste du moteur) : **chaque détecteur rend des CHIFFRES, pas
 * des noms**. « Marteau » ne veut rien dire ; « mèche basse 2,4× le corps, close
 * dans le tiers haut, après 3 bougies baissières » se vérifie. Chaque résultat
 * porte donc `chiffres` (les faits) et `preuves` (phrase prête à afficher).
 *
 * Toutes les fonctions sont PURES (bougies en entrée, données chiffrées en
 * sortie) : vérifiables sans réseau, sans base, sans navigateur.
 *
 * Seuils RELATIFS à l'ATR, jamais en valeur absolue : un marteau sur XAUUSDT en
 * 1 h et sur BTCUSDT en 5 m n'ont pas la même taille en points. Un seuil absolu
 * marcherait sur l'un et jamais sur l'autre.
 */

const { atr } = require('./structure');

/** Bougie attendue : { t, o, h, l, c, v }. */
const ok = c => c && Number.isFinite(c.o) && Number.isFinite(c.h) &&
  Number.isFinite(c.l) && Number.isFinite(c.c);

const corps = c => Math.abs(c.c - c.o);
const mecheH = c => c.h - Math.max(c.o, c.c);   // mèche haute
const mecheB = c => Math.min(c.o, c.c) - c.l;   // mèche basse
const range = c => Math.max(c.h - c.l, 0);
const haussier = c => c.c > c.o;
const baissier = c => c.c < c.o;

const pct = (x, base) => (base > 0 ? x / base : 0);
const r2 = x => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r4 = x => (Number.isFinite(x) ? +x.toFixed(4) : null);

/**
 * Résultat normalisé d'un détecteur.
 * `ok:false` n'est PAS une erreur : c'est « la condition n'est pas remplie », et
 * `raison` dit laquelle et de combien. C'est ce qui permet à l'écran d'afficher
 * « conditions non remplies » au lieu de faire disparaître le concept.
 */
function resultat(id, nom, famille, sens, okFlag, force, chiffres, preuves, raison) {
  return {
    id, nom, famille, sens: okFlag ? sens : 'neutre',
    ok: !!okFlag,
    // Plafond 0,95 et non 1 : une figure parfaite (marteau idéal) atteignait
    // exactement 1,00, un score que le moteur ne peut pas justifier — aucun
    // backtest ne soutient une « certitude ». Le plafond laisse aussi de la
    // marge à l'ajustement de structure (+0,25) sans écraser le calcul.
    force: okFlag ? Math.max(0, Math.min(0.95, +force.toFixed(2))) : 0,
    chiffres: chiffres || {},
    preuves: okFlag ? (preuves || []) : [],
    raison: okFlag ? null : (raison || null)
  };
}

// ─────────────────────────────────────────────────────────────
// MOTIFS D'UNE SEULE BOUGIE
// ─────────────────────────────────────────────────────────────

/** Doji — indécision : le corps est négligeable devant le range. */
function doji(c, a) {
  const rg = range(c), co = corps(c);
  const ratio = pct(co, rg);
  const assezLarge = rg >= 0.3 * a;
  const okFlag = assezLarge && ratio <= 0.10;
  return resultat('doji', 'Doji', 'bougie', 'neutre', okFlag, 0.55 + (0.10 - ratio),
    { corpsRatio: r4(ratio), range: r4(rg), atr: r4(a), corps: r4(co), rangeAtr: r2(pct(rg, a)) },
    [`corps ${(ratio * 100).toFixed(1)} % du range (seuil 10 %)`,
     `range ${r2(rg)} = ${r2(rg / a)}× ATR (minimum 0,3×)`],
    !assezLarge
      ? `range ${r2(rg)} = ${r2(rg / (a || 1))}× ATR, sous le minimum de 0,3× (bougie trop plate pour conclure)`
      : `corps ${(ratio * 100).toFixed(1)} % du range, au-dessus du seuil de 10 % (ce n'est pas une indécision)`);
}

/** Marteau — rejet du bas, après une baisse. */
function marteau(c, a, prec) {
  const rg = range(c), co = corps(c), mb = mecheB(c), mh = mecheH(c);
  const ratioRange = pct(rg, a);
  const coAbs = Math.max(co, rg * 0.02); // évite la division par zéro sur un doji
  const ratioMeche = mb / coAbs;
  const closeHaut = pct(c.c - c.l, rg) >= 0.6; // close dans le tiers haut
  const baisseAvant = prec >= 0.5;             // contexte : N bougies baissières avant
  // La mèche OPPOSÉE se mesure sur le RANGE, pas sur le corps : un corps de 0,15
  // sur un range de 4,1 rendait tout marteau impossible (0,35 × 0,15 = 0,05).
  const mhRatio = pct(mh, rg);
  const okFlag = ratioRange >= 0.5 && ratioMeche >= 2 && closeHaut && mhRatio <= 0.15 && baisseAvant;
  const manque = [];
  if (ratioRange < 0.5) manque.push(`range ${r2(ratioRange)}× ATR < 0,5×`);
  if (ratioMeche < 2) manque.push(`mèche basse ${r2(ratioMeche)}× le corps < 2×`);
  if (!closeHaut) manque.push(`close à ${(pct(c.c - c.l, rg) * 100).toFixed(0)} % du range, sous 60 %`);
  if (mhRatio > 0.15) manque.push(`mèche haute ${(mhRatio * 100).toFixed(0)} % du range (max 15 %)`);
  if (!baisseAvant) manque.push(`pas de baisse préalable (${r2(prec)} en moyenne, minimum 0,5)`);
  return resultat('marteau', 'Marteau', 'bougie', 'long', okFlag, 0.5 + Math.min(0.4, (ratioMeche - 2) / 5) + (closeHaut ? 0.1 : 0),
    { ratioMeche: r2(ratioMeche), closePctRange: r2(pct(c.c - c.l, rg) * 100), rangeAtr: r2(ratioRange), mecheHautePctRange: r2(mhRatio * 100), baisseAvant: r2(prec) },
    [`mèche basse ${r2(ratioMeche)}× le corps (seuil 2×)`,
     `close à ${(pct(c.c - c.l, rg) * 100).toFixed(0)} % du range (seuil 60 %)`,
     `mèche haute ${(mhRatio * 100).toFixed(0)} % du range (max 15 %)`,
     `range ${r2(ratioRange)}× ATR (seuil 0,5×)`,
     `${r2(prec)} bougie(s) baissière(s) avant`],
    manque.join(' · '));
}

/** Étoile filante — rejet du haut, après une hausse. */
function etoileFilante(c, a, prec) {
  const rg = range(c), co = corps(c), mh = mecheH(c), mb = mecheB(c);
  const ratioRange = pct(rg, a);
  const coAbs = Math.max(co, rg * 0.02);
  const ratioMeche = mh / coAbs;
  const closeBas = pct(c.c - c.l, rg) <= 0.4;
  const hausseAvant = prec >= 0.5;
  // Même correction que le marteau : la petite mèche se juge sur le range.
  const mbRatio = pct(mb, rg);
  const okFlag = ratioRange >= 0.5 && ratioMeche >= 2 && closeBas && mbRatio <= 0.15 && hausseAvant;
  const manque = [];
  if (ratioRange < 0.5) manque.push(`range ${r2(ratioRange)}× ATR < 0,5×`);
  if (ratioMeche < 2) manque.push(`mèche haute ${r2(ratioMeche)}× le corps < 2×`);
  if (!closeBas) manque.push(`close à ${(pct(c.c - c.l, rg) * 100).toFixed(0)} % du range, au-dessus de 40 %`);
  if (mbRatio > 0.15) manque.push(`mèche basse ${(mbRatio * 100).toFixed(0)} % du range (max 15 %)`);
  if (!hausseAvant) manque.push(`pas de hausse préalable (${r2(prec)} en moyenne)`);
  return resultat('etoile-filante', 'Étoile filante', 'bougie', 'short', okFlag, 0.5 + Math.min(0.4, (ratioMeche - 2) / 5) + (closeBas ? 0.1 : 0),
    { ratioMeche: r2(ratioMeche), closePctRange: r2(pct(c.c - c.l, rg) * 100), rangeAtr: r2(ratioRange), mecheBassePctRange: r2(mbRatio * 100), hausseAvant: r2(prec) },
    [`mèche haute ${r2(ratioMeche)}× le corps (seuil 2×)`,
     `close à ${(pct(c.c - c.l, rg) * 100).toFixed(0)} % du range (seuil 40 %)`,
     `mèche basse ${(mbRatio * 100).toFixed(0)} % du range (max 15 %)`,
     `range ${r2(ratioRange)}× ATR (seuil 0,5×)`,
     `${r2(prec)} bougie(s) haussière(s) avant`],
    manque.join(' · '));
}

/** Marubozu — momentum : le corps occupe presque tout le range. */
function marubozu(c, a) {
  const rg = range(c), co = corps(c);
  const ratio = pct(co, rg);
  const ratioRange = pct(rg, a);
  const okFlag = ratio >= 0.90 && ratioRange >= 0.6;
  return resultat('marubozu', 'Marubozu', 'bougie', haussier(c) ? 'long' : 'short', okFlag, 0.55 + (ratio - 0.9),
    { corpsRatio: r4(ratio), rangeAtr: r2(ratioRange), corps: r4(co), range: r4(rg) },
    [`corps ${(ratio * 100).toFixed(1)} % du range (seuil 90 %)`,
     `range ${r2(ratioRange)}× ATR (seuil 0,6×)`],
    `corps ${(ratio * 100).toFixed(0)} % du range (seuil 90 %) · range ${r2(ratioRange)}× ATR (seuil 0,6×)`);
}

/** Pin bar — longue mèche d'un côté, corps de l'autre. */
function pinBar(c, a) {
  const rg = range(c);
  if (rg <= 0) return resultat('pin-bar', 'Pin bar', 'bougie', 'neutre', false, 0, {}, [], 'range nul');
  const co = corps(c), mh = mecheH(c), mb = mecheB(c);
  const ratioRange = pct(rg, a);
  const basse = mb / rg, haute = mh / rg, corpsRatio = co / rg;
  const okFlag = ratioRange >= 0.5 && corpsRatio <= 0.33 && (basse >= 0.66 || haute >= 0.66);
  const sens = basse > haute ? 'long' : 'short';
  return resultat('pin-bar', 'Pin bar', 'bougie', sens, okFlag, 0.55 + Math.max(basse, haute) * 0.3,
    { mecheBasseRatio: r4(basse), mecheHauteRatio: r4(haute), corpsRatio: r4(corpsRatio), rangeAtr: r2(ratioRange) },
    [`mèche ${sens === 'long' ? 'basse' : 'haute'} = ${((sens === 'long' ? basse : haute) * 100).toFixed(0)} % du range (seuil 66 %)`,
     `corps ${(corpsRatio * 100).toFixed(0)} % du range (max 33 %)`,
     `range ${r2(ratioRange)}× ATR (seuil 0,5×)`],
    `mèche max ${((Math.max(basse, haute)) * 100).toFixed(0)} % du range (seuil 66 %) · corps ${(corpsRatio * 100).toFixed(0)} % (max 33 %)`);
}

// ─────────────────────────────────────────────────────────────
// MOTIFS DE DEUX BOUGIES
// ─────────────────────────────────────────────────────────────

/** Avalement (engulfing) — le corps courant englobe le précédent, sens opposé. */
function avalement(c, p, a) {
  const base = {
    corpsActuel: r4(corps(c)), corpsPrecedent: r4(corps(p)),
    rangeAtr: r2(pct(range(c), a))
  };
  if (!baissier(p) || !haussier(c)) {
    return resultat('avalement', 'Avalement', 'bougie', 'neutre', false, 0,
      base, [], !haussier(c) ? 'la bougie courante n\'est pas haussière (avalement haussier attendu)' : 'la précédente n\'est pas baissière');
  }
  const englobe = Math.max(c.o, c.c) >= p.o && Math.min(c.o, c.c) <= p.c;
  const plusGros = corps(c) > corps(p);
  const assezLarge = range(c) >= 0.5 * a;
  const okFlag = englobe && plusGros && assezLarge;
  const manque = [];
  if (!englobe) manque.push('le corps courant n\'englobe pas le corps précédent');
  if (!plusGros) manque.push(`corps ${r2(corps(c))} ≤ corps précédent ${r2(corps(p))}`);
  if (!assezLarge) manque.push(`range ${r2(pct(range(c), a))}× ATR < 0,5×`);
  return resultat('avalement', 'Avalement haussier', 'bougie', 'long', okFlag,
    0.6 + Math.min(0.3, pct(corps(c), Math.max(corps(p), 1e-9)) / 10),
    base,
    [`corps ${r2(corps(c))} englobe les ${r2(corps(p))} précédents (${r2(corps(c) / Math.max(corps(p), 1e-9))}×)`,
     `range ${r2(pct(range(c), a))}× ATR (seuil 0,5×)`],
    manque.join(' · '));
}

/** Harami — le corps courant est contenu dans le précédent : essoufflement. */
function harami(c, p, a) {
  const dedans = Math.max(c.o, c.c) <= Math.max(p.o, p.c) && Math.min(c.o, c.c) >= Math.min(p.o, p.c);
  const oppose = (haussier(c) && baissier(p)) || (baissier(c) && haussier(p));
  const grosAvant = corps(p) >= 2 * corps(c);
  const okFlag = dedans && oppose && grosAvant;
  const manque = [];
  if (!dedans) manque.push('le corps courant n\'est pas contenu dans le précédent');
  if (!oppose) manque.push('même sens que la bougie précédente');
  if (!grosAvant) manque.push(`corps précédent ${r2(corps(p))} < 2× le courant ${r2(corps(c))}`);
  return resultat('harami', 'Harami', 'bougie', baissier(p) ? 'long' : 'short', okFlag,
    0.5 + Math.min(0.25, pct(corps(c), Math.max(corps(p), 1e-9)) * 0.5),
    { corpsCourant: r4(corps(c)), corpsPrecedent: r4(corps(p)), rangeAtr: r2(pct(range(c), a)) },
    [`corps ${r2(corps(c))} contenu dans ${r2(corps(p))} (${r2(corps(p) / Math.max(corps(c), 1e-9))}× plus petit)`,
     `sens opposé à la bougie précédente`],
    manque.join(' · '));
}

/** Inside bar — compression : la bougie tient entièrement dans la précédente. */
function insideBar(c, p) {
  const okFlag = c.h < p.h && c.l > p.l;
  return resultat('inside-bar', 'Inside bar', 'bougie', 'neutre', okFlag, 0.5,
    { hautCourant: r4(c.h), hautPrecedent: r4(p.h), basCourant: r4(c.l), basPrecedent: r4(p.l) },
    [`range ${r2(c.h - c.l)} contenu dans ${r2(p.h - p.l)} (${r2(pct(c.h - c.l, Math.max(p.h - p.l, 1e-9)) * 100)} %)`],
    `la bougie dépasse la précédente (haut ${r2(c.h)} vs ${r2(p.h)}, bas ${r2(c.l)} vs ${r2(p.l)})`);
}

// ─────────────────────────────────────────────────────────────
// MOTIFS DE GRAPHIQUE (plusieurs bougies)
// ─────────────────────────────────────────────────────────────

/**
 * Double top / double bottom — deux extrêmes au même prix, validés par la cassure
 * du col. La tolérance est RELATIVE À L'ATR : deux sommets à 0,2× ATR d'écart sont
 * le même niveau ; à 3× ATR ce sont deux sommets différents.
 */
function doubleExtreme(candles, a, { fenetre = 60, tolerance = 0.3, ecartMin = 5 } = {}) {
  const n = Math.min(fenetre, candles.length - 1);
  if (n < 12) {
    const r = resultat('double-top', 'Double top', 'graphique', 'neutre', false, 0, { bougies: n },
      [], `seulement ${n} bougies (minimum 12 pour chercher deux extrêmes)`);
    const rb = resultat('double-bottom', 'Double bottom', 'graphique', 'neutre', false, 0, { bougies: n },
      [], `seulement ${n} bougies (minimum 12)`);
    return { top: r, bottom: rb };
  }

  const zone = candles.slice(-n - 1);
  // Extrêmes locaux (fenêtre de 2 de chaque côté).
  const hauts = [], bas = [];
  for (let i = 2; i < zone.length - 2; i++) {
    const c = zone[i];
    if (c.h >= zone[i - 1].h && c.h >= zone[i - 2].h && c.h >= zone[i + 1].h && c.h >= zone[i + 2].h) hauts.push({ i, p: c.h, t: c.t });
    if (c.l <= zone[i - 1].l && c.l <= zone[i - 2].l && c.l <= zone[i + 1].l && c.l <= zone[i + 2].l) bas.push({ i, p: c.l, t: c.t });
  }

  const dernier = zone[zone.length - 1];
  const ecartTol = tolerance * a;

  function paire(liste, sens) {
    if (liste.length < 2) {
      return { ok: false, raison: `un seul extrême local détecté (il en faut 2)` };
    }
    // Les deux extrêmes les plus RÉCENTS qui se valent en prix, séparés d'au
    // moins `ecartMin`. On préfère la paire récente : c'est celle que lit un
    // trader devant son graphique, pas la paire la plus serrée de tout l'historique
    // (deux creux identiques vieux de 40 bougies ne forment plus un motif actif).
    let best = null;
    for (let i = 0; i < liste.length; i++) {
      for (let j = i + 1; j < liste.length; j++) {
        if (Math.abs(liste[j].i - liste[i].i) < ecartMin) continue;
        const diff = Math.abs(liste[j].p - liste[i].p);
        if (diff > ecartTol) continue;
        // Plus récent = second point plus proche de la fin ; à récence égale,
        // on garde l'écart de prix le plus faible.
        if (!best || liste[j].i > best.b.i || (liste[j].i === best.b.i && diff < best.diff)) {
          best = { a: liste[i], b: liste[j], diff };
        }
      }
    }
    if (!best) {
      // On explique de combien le plus proche couple échoue.
      let mini = Infinity, detail = 'aucun couple';
      for (let i = 0; i < liste.length; i++) {
        for (let j = i + 1; j < liste.length; j++) {
          if (Math.abs(liste[j].i - liste[i].i) < ecartMin) continue;
          const diff = Math.abs(liste[j].p - liste[i].p);
          if (diff < mini) { mini = diff; detail = `écart ${r2(diff)} entre ${r2(liste[i].p)} et ${r2(liste[j].p)}`; }
        }
      }
      return { ok: false, raison: `${detail} — tolérance ${r2(ecartTol)} (${tolerance}× ATR)` };
    }
    // Col : le creux (top) ou le sommet (bottom) entre les deux extrêmes.
    const [p1, p2] = best.a.i < best.b.i ? [best.a, best.b] : [best.b, best.a];
    const entre = zone.slice(p1.i, p2.i + 1);
    const col = sens === 'top'
      ? Math.min(...entre.map(c => c.l))
      : Math.max(...entre.map(c => c.h));
    const cassure = sens === 'top' ? dernier.c < col : dernier.c > col;
    return { ok: true, best, col, cassure, p1, p2 };
  }

  const top = paire(hauts, 'top');
  const bottom = paire(bas, 'bottom');

  const rTop = top.ok
    ? resultat('double-top', 'Double top', 'graphique', 'short', top.cassure,
        0.6 + (top.cassure ? 0.2 : 0) + (1 - pct(top.best.diff, Math.max(ecartTol, 1e-9))) * 0.1,
        { sommet1: r4(top.p1.p), sommet2: r4(top.best.b.p), ecart: r4(top.best.diff), tolerance: r4(ecartTol), col: r4(top.col), cassure: top.cassure, extremes: hauts.length },
        [`deux sommets à ${r2(top.p1.p)} et ${r2(top.best.b.p)} (écart ${r2(top.best.diff)} ≤ ${r2(ecartTol)})`,
         top.cassure ? `col ${r2(top.col)} cassé à la baisse (close ${r2(dernier.c)})` : `col ${r2(top.col)} PAS encore cassé (close ${r2(dernier.c)})`],
        `forme présente mais col ${r2(top.col)} non cassé — close ${r2(dernier.c)}`)
    : resultat('double-top', 'Double top', 'graphique', 'neutre', false, 0,
        { tolerance: r4(ecartTol), extremes: hauts.length }, [], top.raison);

  const rBottom = bottom.ok
    ? resultat('double-bottom', 'Double bottom', 'graphique', 'long', bottom.cassure,
        0.6 + (bottom.cassure ? 0.2 : 0) + (1 - pct(bottom.best.diff, Math.max(ecartTol, 1e-9))) * 0.1,
        { creux1: r4(bottom.p1.p), creux2: r4(bottom.best.b.p), ecart: r4(bottom.best.diff), tolerance: r4(ecartTol), col: r4(bottom.col), cassure: bottom.cassure, extremes: bas.length },
        [`deux creux à ${r2(bottom.p1.p)} et ${r2(bottom.best.b.p)} (écart ${r2(bottom.best.diff)} ≤ ${r2(ecartTol)})`,
         bottom.cassure ? `col ${r2(bottom.col)} cassé à la hausse (close ${r2(dernier.c)})` : `col ${r2(bottom.col)} PAS encore cassé (close ${r2(dernier.c)})`],
        `forme présente mais col ${r2(bottom.col)} non cassé — close ${r2(dernier.c)}`)
    : resultat('double-bottom', 'Double bottom', 'graphique', 'neutre', false, 0,
        { tolerance: r4(ecartTol), extremes: bas.length }, [], bottom.raison);

  return { top: rTop, bottom: rBottom };
}

/**
 * Cassure de trendline — droite passant par les deux derniers sommets (baissière)
 * ou les deux derniers creux (haussière), et cassure par la clôture.
 * La pente est exprimée en points PAR BOUGIE, donc comparable entre unités de temps.
 */
function trendline(candles, a, { fenetre = 50, marge = 0.15 } = {}) {
  const n = Math.min(fenetre, candles.length);
  if (n < 15) return resultat('trendline', 'Cassure de trendline', 'graphique', 'neutre', false, 0, { bougies: n }, [], `${n} bougies seulement (minimum 15)`);
  const zone = candles.slice(-n);
  const hauts = [], bas = [];
  for (let i = 2; i < zone.length - 2; i++) {
    const c = zone[i];
    if (c.h >= zone[i - 1].h && c.h >= zone[i - 2].h && c.h >= zone[i + 1].h && c.h >= zone[i + 2].h) hauts.push({ i, p: c.h });
    if (c.l <= zone[i - 1].l && c.l <= zone[i - 2].l && c.l <= zone[i + 1].l && c.l <= zone[i + 2].l) bas.push({ i, p: c.l });
  }
  const dernier = zone[zone.length - 1];
  const idx = zone.length - 1;

  const essais = [];
  if (hauts.length >= 2) {
    const [a1, a2] = hauts.slice(-2);
    const pente = (a2.p - a1.p) / Math.max(a2.i - a1.i, 1);
    const projete = a2.p + pente * (idx - a2.i);
    const margeAbs = marge * a;
    // Trendline baissière cassée à la hausse.
    if (pente < 0 && dernier.c > projete + margeAbs) {
      essais.push({ sens: 'long', label: 'baissière', a1: a1.p, a2: a2.p, pente, projete, cassure: dernier.c - projete });
    }
  }
  if (bas.length >= 2) {
    const [b1, b2] = bas.slice(-2);
    const pente = (b2.p - b1.p) / Math.max(b2.i - b1.i, 1);
    const projete = b2.p + pente * (idx - b2.i);
    const margeAbs = marge * a;
    // Trendline haussière cassée à la baisse.
    if (pente > 0 && dernier.c < projete - margeAbs) {
      essais.push({ sens: 'short', label: 'haussière', a1: b1.p, a2: b2.p, pente, projete, cassure: projete - dernier.c });
    }
  }

  if (!essais.length) {
    const info = {
      hauts: hauts.length, bas: bas.length,
      marge: r4(marge * a),
      penteHauts: hauts.length >= 2 ? r4((hauts[hauts.length - 1].p - hauts[hauts.length - 2].p) / Math.max(hauts[hauts.length - 1].i - hauts[hauts.length - 2].i, 1)) : null,
      penteBas: bas.length >= 2 ? r4((bas[bas.length - 1].p - bas[bas.length - 2].p) / Math.max(bas[bas.length - 1].i - bas[bas.length - 2].i, 1)) : null
    };
    return resultat('trendline', 'Cassure de trendline', 'graphique', 'neutre', false, 0, info, [],
      `aucune trendline cassée avec une marge de ${r2(marge * a)} (${marge}× ATR) — ${hauts.length} sommet(s), ${bas.length} creux`);
  }
  const e = essais[0];
  return resultat('trendline', `Cassure de trendline ${e.label}`, 'graphique', e.sens,
    true, // ← condition remplie (cet argument avait été oublié : la force glissait
          //   dans la case okFlag et les chiffres prenaient sa place)
    0.55 + Math.min(0.3, pct(Math.abs(e.cassure), Math.max(a, 1e-9)) * 0.3),
    { penteParBougie: r4(e.pente), projete: r4(e.projete), close: r4(dernier.c), depassement: r4(Math.abs(e.cassure)), marge: r4(marge * a) },
    [`droite ${e.label} par ${r2(e.a1)} puis ${r2(e.a2)} (pente ${r4(e.pente)}/bougie)`,
     `projeté ${r2(e.projete)}, close ${r2(dernier.c)} → dépassement ${r2(Math.abs(e.cassure))} (> marge ${r2(marge * a)})`],
    null);
}

/**
 * Compression / triangle — la volatilité récente se resserre.
 * Mesuré : ATR court (5) contre ATR long (20). Sous 60 %, le marché se comprime.
 */
function compression(candles, { court = 5, long = 20, seuil = 0.6 } = {}) {
  if (candles.length < long + 2) {
    return resultat('compression', 'Compression', 'graphique', 'neutre', false, 0, { bougies: candles.length }, [], `${candles.length} bougies (minimum ${long + 2})`);
  }
  const aCourt = atr(candles.slice(-(court + 1)), court);
  const aLong = atr(candles.slice(-(long + 1)), long);
  if (!aCourt || !aLong) return resultat('compression', 'Compression', 'graphique', 'neutre', false, 0, {}, [], 'ATR non calculable');
  const ratio = aCourt / aLong;
  const okFlag = ratio <= seuil;
  return resultat('compression', 'Compression (triangle)', 'graphique', 'neutre', okFlag, 0.5 + (seuil - ratio),
    { atrCourt: r4(aCourt), atrLong: r4(aLong), ratio: r4(ratio), seuil },
    [`ATR ${court} périodes = ${r2(aCourt)}, ATR ${long} = ${r2(aLong)} → ${(ratio * 100).toFixed(0)} % (seuil ${(seuil * 100).toFixed(0)} %)`],
    `ATR court ${r2(aCourt)} = ${(ratio * 100).toFixed(0)} % de l'ATR long ${r2(aLong)}, au-dessus du seuil de ${(seuil * 100).toFixed(0)} %`);
}

/**
 * Support / résistance — un niveau touché au moins 2 fois, et le prix dessus.
 * La tolérance de touche est relative à l'ATR.
 */
function supportResistance(candles, a, { fenetre = 80, tolerance = 0.3 } = {}) {
  const n = Math.min(fenetre, candles.length);
  if (n < 20) return resultat('support-resistance', 'Support / résistance', 'graphique', 'neutre', false, 0, { bougies: n }, [], `${n} bougies (minimum 20)`);
  const zone = candles.slice(-n);
  const dernier = zone[zone.length - 1];
  const tol = tolerance * a;

  // Regroupe les extrêmes proches en niveaux, compte les touches.
  const points = [];
  for (let i = 2; i < zone.length - 2; i++) {
    const c = zone[i];
    if (c.h >= zone[i - 1].h && c.h >= zone[i + 1].h) points.push({ p: c.h, type: 'resistance' });
    if (c.l <= zone[i - 1].l && c.l <= zone[i + 1].l) points.push({ p: c.l, type: 'support' });
  }
  const niveaux = [];
  for (const pt of points) {
    const existant = niveaux.find(x => Math.abs(x.p - pt.p) <= tol && x.type === pt.type);
    if (existant) { existant.touches++; existant.p = (existant.p + pt.p) / 2; }
    else niveaux.push({ p: pt.p, type: pt.type, touches: 1 });
  }
  const valides = niveaux.filter(x => x.touches >= 2);
  if (!valides.length) {
    return resultat('support-resistance', 'Support / résistance', 'graphique', 'neutre', false, 0,
      { niveauxTestes: niveaux.length, tolerance: r4(tol) }, [],
      `aucun niveau touché 2 fois (${niveaux.length} niveau(x) testé(s), tolérance ${r2(tol)}) — le plus touché : ${niveaux.length ? Math.max(...niveaux.map(x => x.touches)) : 0} fois`);
  }
  // Le niveau valide le plus proche du prix courant.
  let proche = null;
  for (const lv of valides) {
    const d = Math.abs(dernier.c - lv.p);
    if (!proche || d < proche.d) proche = { ...lv, d };
  }
  const dessus = dernier.c > proche.p;
  const sens = proche.type === 'support' ? 'long' : 'short';
  const okFlag = proche.d <= tol * 2;
  return resultat('support-resistance', `${proche.type === 'support' ? 'Support' : 'Résistance'} ${r2(proche.p)}`, 'graphique', sens, okFlag,
    0.5 + Math.min(0.3, (proche.touches - 2) * 0.1) + (1 - pct(proche.d, Math.max(tol * 2, 1e-9))) * 0.15,
    { niveau: r4(proche.p), touches: proche.touches, distance: r4(proche.d), tolerance: r4(tol), prixDessus: dessus, niveauxValides: valides.length },
    [`niveau ${proche.type} ${r2(proche.p)} touché ${proche.touches} fois (tolérance ${r2(tol)})`,
     `prix ${r2(dernier.c)} à ${r2(proche.d)} du niveau (${r2(pct(proche.d, a))}× ATR)`],
    `le niveau ${r2(proche.p)} est à ${r2(proche.d)} du prix, au-delà de ${r2(tol * 2)} (prix trop loin pour un retest)`);
}

// ─────────────────────────────────────────────────────────────
// CONTEXTE : tendance courte, pour valider les retournements
// ─────────────────────────────────────────────────────────────

/** Proportion de bougies baissières (ou haussières) sur les N dernières. */
function proportion(candles, n, sens) {
  const zone = candles.slice(-Math.min(n, candles.length));
  if (!zone.length) return 0;
  const compte = zone.filter(c => (sens === 'baissier' ? baissier(c) : haussier(c))).length;
  return compte / zone.length;
}

// ─────────────────────────────────────────────────────────────
// POINT D'ENTRÉE
// ─────────────────────────────────────────────────────────────

/**
 * Évalue TOUS les motifs et rend la liste complète, remplis comme non remplis.
 *
 * @param {Array} candles bougies OHLCV, la dernière clôturée en fin de tableau
 * @param {{courte?:number}} [opts]
 * @returns {{atr:number, motifs:Array, retenus:Array, parSens:{long:Array,short:Array}}}
 */
function analyse(candles, opts = {}) {
  const liste = (candles || []).filter(ok);
  if (liste.length < 20) {
    return { atr: null, motifs: [], retenus: [], parSens: { long: [], short: [] }, raison: `pas assez de bougies (${liste.length}, minimum 20)` };
  }
  const a = atr(liste, 14);
  if (!a || a <= 0) {
    return { atr: null, motifs: [], retenus: [], parSens: { long: [], short: [] }, raison: 'ATR nul ou non calculable (série plate)' };
  }

  const dernier = liste[liste.length - 1];
  const avant = liste[liste.length - 2];
  const precBaissier = proportion(liste.slice(0, -1), opts.courte || 6, 'baissier');
  const precHaussier = proportion(liste.slice(0, -1), opts.courte || 6, 'haussier');

  const motifs = [
    doji(dernier, a),
    marteau(dernier, a, precBaissier),
    etoileFilante(dernier, a, precHaussier),
    marubozu(dernier, a),
    pinBar(dernier, a),
    avalement(dernier, avant, a),
    harami(dernier, avant, a),
    insideBar(dernier, avant)
  ];

  if (liste.length >= 3) {
    // Avalement baissier : même logique, sens inverse, évalué séparément pour que
    // les deux directions soient toujours listées (l'écran montre les deux).
    const p = avant, c = dernier;
    const englobe = haussier(p) && baissier(c) &&
      Math.max(c.o, c.c) >= p.c && Math.min(c.o, c.c) <= p.o &&
      corps(c) > corps(p) && range(c) >= 0.5 * a;
    motifs.push(resultat('avalement-baissier', 'Avalement baissier', 'bougie', 'short', englobe,
      0.6 + Math.min(0.3, pct(corps(c), Math.max(corps(p), 1e-9)) / 10),
      { corpsActuel: r4(corps(c)), corpsPrecedent: r4(corps(p)), rangeAtr: r2(pct(range(c), a)) },
      [`corps ${r2(corps(c))} englobe les ${r2(corps(p))} précédents (${r2(corps(c) / Math.max(corps(p), 1e-9))}×)`,
       `range ${r2(pct(range(c), a))}× ATR (seuil 0,5×)`],
      !baissier(c) ? 'la bougie courante n\'est pas baissière' : 'condition d\'englement non remplie (corps ou range insuffisant)'));
  }

  const de = doubleExtreme(liste, a);
  motifs.push(de.top, de.bottom);
  motifs.push(trendline(liste, a));
  motifs.push(compression(liste));
  motifs.push(supportResistance(liste, a));

  const retenus = motifs.filter(m => m.ok);
  return {
    atr: a,
    motifs,
    retenus,
    parSens: {
      long: retenus.filter(m => m.sens === 'long'),
      short: retenus.filter(m => m.sens === 'short'),
      neutre: retenus.filter(m => m.sens === 'neutre')
    }
  };
}

module.exports = {
  analyse, doji, marteau, etoileFilante, marubozu, pinBar, avalement, harami,
  insideBar, doubleExtreme, trendline, compression, supportResistance,
  // exposés pour les tests
  corps, mecheH, mecheB, range
};
