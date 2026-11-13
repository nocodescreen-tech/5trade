/**
 * PARCOURS DU PRIX AUTOUR D'UNE ZONE — phase 3.
 *
 * Le moteur savait détecter une zone (order block, FVG) et dessiner un
 * rectangle. Il ne savait pas dire OÙ EN EST LE PRIX par rapport à elle :
 * jamais revenu, en approche, dedans, rejetée, cassée, confirmée, expirée.
 *
 * Détecter un FVG et attendre son retest ne sont pas la même information. Sans
 * cet état, l'écran affiche vingt zones « actives » dont la moitié sont déjà
 * invalidées depuis longtemps.
 *
 * Aucune valeur n'est inventée : chaque état est déduit des bougies réellement
 * postérieures à la création de la zone, et il est accompagné de sa preuve.
 */

/** Seuils, exprimés en multiples d'ATR pour être comparables entre marchés. */
const SEUILS = {
  approche: 0.35,     // distance à la zone en deçà de laquelle on « approche »
  rejet: 0.30,        // sortie de zone suffisante pour parler de rejet
  confirmation: 0.60, // déplacement au-delà de la zone pour confirmer
  expiration: 60      // bougies sans confirmation avant expiration
};

const ETATS = ['NOT_RETURNED', 'APPROACHING', 'IN_ZONE', 'REJECTED', 'BROKEN', 'CONFIRMED', 'EXPIRED'];

/**
 * @param {object} zone    { type: 'bullish'|'bearish', low, high, ts?, index? }
 * @param {Array}  candles bougies postérieures (ou toutes, avec zone.ts)
 * @param {object} opts    { atr, ageMax }
 */
function etatZone(zone, candles, opts = {}) {
  const base = {
    type: zone && zone.type, low: zone && Number(zone.low), high: zone && Number(zone.high),
    etat: 'NOT_RETURNED', preuves: [], bougiesDepuis: 0, distanceAtr: null
  };
  if (!zone || !Number.isFinite(base.low) || !Number.isFinite(base.high) || base.low > base.high) {
    return { ...base, etat: 'INCONNU', motif: 'zone invalide (bornes absentes ou inversées)' };
  }
  const bougies = Array.isArray(candles) ? candles : [];
  const iZone = Number.isFinite(zone.index) ? zone.index : 0;
  const apres = bougies.slice(iZone + 1);
  if (!apres.length) {
    return { ...base, etat: 'NOT_RETURNED', motif: 'aucune bougie après la création de la zone' };
  }

  const atr = Number.isFinite(Number(opts.atr)) && Number(opts.atr) > 0
    ? Number(opts.atr)
    : (() => {
      // ATR approximatif si l'appelant ne le fournit pas : moyenne des
      // amplitudes. On le dit dans les preuves plutôt que de faire semblant.
      const amp = apres.slice(-14).map(c => Math.abs(c.h - c.l)).filter(Number.isFinite);
      return amp.length ? amp.reduce((a, b) => a + b, 0) / amp.length : null;
    })();

  const haussier = base.type === 'bullish';
  const ageMax = Number.isFinite(opts.ageMax) ? opts.ageMax : SEUILS.expiration;

  // On raisonne sur la DERNIÈRE INTERACTION avec la zone, pas sur un drapeau
  // « le prix est déjà entré ». Ce drapeau restait vrai pour toujours : une
  // bougie située 300 points plus haut était lue comme un « rejet », et toutes
  // les zones finissaient CONFIRMED — y compris avec un déplacement de 0,0004.
  const touche = c => c.l <= base.high && c.h >= base.low;
  let derniereInteraction = null;   // { i, close, ecart, casse }

  for (let k = 0; k < apres.length; k++) {
    const c = apres[k];
    if (!touche(c)) continue;
    const ecart = haussier ? c.c - base.high : base.low - c.c;
    const casse = haussier ? c.c < base.low : c.c > base.high;
    derniereInteraction = { i: k, close: c.c, ecart: +ecart.toFixed(6), casse };
  }

  const dernier = apres[apres.length - 1];
  const distance = base.low <= dernier.c && dernier.c <= base.high ? 0
    : Math.min(Math.abs(dernier.c - base.low), Math.abs(dernier.c - base.high));
  const distanceAtr = atr ? +(distance / atr).toFixed(2) : null;

  let etat = 'NOT_RETURNED';
  const preuves = [];
  const seuilRejet = atr ? atr * SEUILS.rejet : null;
  const seuilConf = atr ? atr * SEUILS.confirmation : null;

  if (!derniereInteraction) {
    etat = 'NOT_RETURNED';
    preuves.push(distanceAtr !== null
      ? `prix à ${distanceAtr} ATR : la zone n'a jamais été retestée`
      : "la zone n'a jamais été retestée (distance non mesurable)");
    if (distanceAtr !== null && distanceAtr <= SEUILS.approche) {
      etat = 'APPROACHING';
      preuves.unshift(`à ${distanceAtr} ATR de la zone`);
    }
  } else if (derniereInteraction.casse) {
    etat = 'BROKEN';
    preuves.push(`clôture ${derniereInteraction.close} au-delà de la zone (${base.low}–${base.high}) à la bougie ${derniereInteraction.i}`);
  } else if (base.low <= dernier.c && dernier.c <= base.high) {
    etat = 'IN_ZONE';
    preuves.push(`prix dans la zone (${base.low}–${base.high})`);
  } else if (seuilConf !== null && derniereInteraction.ecart >= seuilConf) {
    etat = 'CONFIRMED';
    // Précision adaptative : sur EURUSD le seuil vaut 0,0002 et `toFixed(2)`
    // affichait « ≥ 0.00 », ce qui laissait croire à un seuil nul.
    const fmt = v => (Math.abs(v) >= 1 ? v.toFixed(2) : String(+v.toPrecision(3)));
    preuves.push(`rejet puis déplacement de ${fmt(derniereInteraction.ecart)} (≥ ${fmt(seuilConf)}) à la bougie ${derniereInteraction.i}`);
  } else if (seuilRejet !== null && derniereInteraction.ecart >= seuilRejet) {
    etat = 'REJECTED';
    preuves.push(`entrée puis retour du bon côté (+${derniereInteraction.ecart}) à la bougie ${derniereInteraction.i}`);
  } else {
    etat = 'IN_ZONE';
    preuves.push(`zone touchée, réaction insuffisante (${derniereInteraction.ecart} écart)`);
  }

  // Expiration : au bout de N bougies, une zone qui n'est plus en contact avec
  // le prix n'est plus une occasion, c'est un dessin. On l'applique aussi aux
  // zones « confirmées » : mesuré sur R_75, quatre FVG confirmaient un
  // événement vieux de 50 bougies alors que le prix était 750 points plus bas.
  // Un état décrit ce qui s'est passé ; l'expiration dit si cela compte encore.
  const depuisInteraction = derniereInteraction ? apres.length - 1 - derniereInteraction.i : apres.length;
  if (etat !== 'IN_ZONE' && depuisInteraction > ageMax) {
    const avant = etat;
    etat = 'EXPIRED';
    preuves.unshift(`${depuisInteraction} bougies depuis la dernière interaction (seuil ${ageMax})`
      + (avant !== 'NOT_RETURNED' && avant !== 'APPROACHING' ? ` — dernier état : ${avant}` : ''));
  }

  return {
    ...base, etat, preuves, bougiesDepuis: apres.length,
    distanceAtr, atr: atr ? +atr.toFixed(4) : null,
    atrMesure: Number.isFinite(Number(opts.atr)) ? 'fourni' : 'estimé (amplitude moyenne)'
  };
}

/**
 * Suit toutes les zones d'un rapport de structure.
 * @returns {{zones:Array, resume:Object}}
 */
function suivreZones(report, candles, opts = {}) {
  const brutes = [
    ...((report && report.orderBlocks) || []).map(z => ({ ...z, origine: 'order block' })),
    ...((report && report.fvgs) || []).map(z => ({ ...z, origine: 'FVG' }))
  ];
  const zones = brutes.map(z => ({ origine: z.origine, ...etatZone(z, candles, opts) }));
  const resume = {};
  for (const e of ETATS) resume[e] = zones.filter(z => z.etat === e).length;
  return { zones, resume, total: zones.length };
}

module.exports = { etatZone, suivreZones, ETATS, SEUILS };
