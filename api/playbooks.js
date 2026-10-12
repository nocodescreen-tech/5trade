/**
 * 5trade — Playbooks : les différents TYPES de trade, avec leurs prérequis et
 * leurs étapes.
 *
 * Pourquoi ce module : un signal n'est pas « 2 règles sur 4 ». Selon ce qu'on
 * fait — un scalp de quelques minutes, une chasse à la liquidité, une entrée
 * intraday ou un swing — les PRÉREQUIS ne sont pas les mêmes et les ÉTAPES ne
 * s'enchaînent pas dans le même ordre. Un scalp exige de la volatilité et une
 * session active ; un swing exige une tendance de fond et une position dans le
 * range. Mélanger les deux produit des signaux contradictoires.
 *
 * Chaque étape est ÉVALUÉE sur le graphique réel : on affiche ce qui est
 * franchi, ce qui manque, et pourquoi. Aucune étape n'est décorative.
 */

const TYPES = {
  scalping: {
    id: 'scalping', nom: 'Scalping', timeframes: ['1m', '5m', '15m'],
    duree: 'quelques minutes', risque: 'stop très serré (1× ATR)',
    quand: 'marché actif, spread faible, session Londres ou New York'
  },
  liquidite: {
    id: 'liquidite', nom: 'Chasse à la liquidité', timeframes: ['5m', '15m', '1h'],
    duree: 'quelques heures', risque: 'stop derrière l’extrême balayé',
    quand: 'un amas de stops est visible juste devant ou derrière le prix'
  },
  intraday: {
    id: 'intraday', nom: 'Intraday', timeframes: ['5m', '15m', '1h'],
    duree: 'la journée', risque: 'stop sous la zone, objectif sur la liquidité opposée',
    quand: 'tendance nette sur 1 h et session ouverte'
  },
  swing: {
    id: 'swing', nom: 'Swing', timeframes: ['1h', '4h', '1d'],
    duree: 'plusieurs jours', risque: 'stop large (2× ATR), position réduite',
    quand: 'tendance de fond claire, prix en discount ou en premium sur 4 h'
  }
};

const pct = v => `${(v * 100).toFixed(0)} %`;
const f2 = v => (Number.isFinite(v) ? Number(v).toFixed(2) : '—');
const haussier = t => /bull|haus/i.test(String(t || ''));
const baissier = t => /bear|baiss/i.test(String(t || ''));

/**
 * Évalue un playbook sur un rapport de structure déjà calculé.
 * @param {object} r rapport de structure.analyze()
 * @param {string} type identifiant du playbook
 * @returns {{type, nom, prerequis:Array, etapes:Array, pret, avancement, blocage}}
 */
function evaluer(r, type) {
  const t = TYPES[type];
  if (!t) return null;

  const st = r.structure || {};
  const pd = r.premiumDiscount || {};
  const se = r.sessions || {};
  const pl = r.previousLevels || {};
  const atr = r.atr14 || 0;
  const prix = r.lastPrice;
  const liq = r.liquidity || [];
  const sw = r.sweeps || [];
  const zones = [...(r.orderBlocks || []), ...(r.fvgs || [])];
  const trend = st.trend;
  // La session peut valoir « Londres + New York + Chevauchement… » : une
  // comparaison d'egalite la declarait fermee alors qu'elle est bien ouverte.
  const sessionActive = /Londres|New York|Chevauchement/i.test(String(se.sessionCourante || ''));
  const killActive = !!se.killZone && se.killZone !== 'aucune en ce moment';

  // Amas de liquidité les plus proches, dans chaque sens.
  const auDessus = liq.filter(l => l.price > prix).sort((a, b) => a.price - b.price)[0];
  const enDessous = liq.filter(l => l.price < prix).sort((a, b) => b.price - a.price)[0];
  const distAtr = cible => (cible && atr ? Math.abs(cible - prix) / atr : null);
  const distPct = cible => (cible ? (Math.abs(cible - prix) / prix) * 100 : null);
  const zoneProche = zones
    .filter(z => Number.isFinite(z.low) && Number.isFinite(z.high))
    .map(z => ({ ...z, d: Math.min(Math.abs(prix - z.low), Math.abs(prix - z.high)) }))
    .sort((a, b) => a.d - b.d)[0];
  const zoneDistanceAtr = zoneProche && atr ? zoneProche.d / atr : null;
  const balayageRecent = sw[sw.length - 1] || null;

  const P = [], E = [];
  const etape = (n, label, ok, detail) => E.push({ numero: n, label, ok: !!ok, detail: detail || null });

  if (type === 'scalping') {
    P.push({ label: 'Volatilité suffisante', ok: atr > 0 && atr / prix > 0.0005,
      detail: `ATR ${f2(atr)} (${((atr / prix) * 100).toFixed(2)} % du prix)` });
    P.push({ label: 'Session active', ok: sessionActive || killActive,
      detail: `${se.sessionCourante || '—'}${killActive ? ' · kill zone ouverte' : ''}` });
    P.push({ label: 'Zone exploitable à proximité', ok: !!zoneProche && zoneDistanceAtr !== null && zoneDistanceAtr < 1.5,
      detail: zoneProche ? `zone la plus proche à ${f2(zoneProche.d)} (${zoneDistanceAtr !== null ? zoneDistanceAtr.toFixed(1) + '× ATR' : '—'})` : 'aucune zone identifiée' });

    etape(1, 'Balayage d’un extrême (liquidité prise)', !!balayageRecent && !!balayageRecent.reclaimed,
      balayageRecent ? `${balayageRecent.type} à ${f2(balayageRecent.level)}${balayageRecent.reclaimed ? ' · niveau repris' : ' · sans reprise'}` : 'aucun balayage récent');
    etape(2, 'Rejet immédiat sur une zone', !!zoneProche && zoneDistanceAtr !== null && zoneDistanceAtr < 0.5,
      zoneProche ? `distance à la zone : ${zoneDistanceAtr !== null ? zoneDistanceAtr.toFixed(2) + '× ATR' : '—'}` : null);
    etape(3, 'Alignement 1 m / 5 m / 15 m', null, 'vérifié par la confluence');
    etape(4, 'Entrée au retour sur la zone', null, 'déclenchée par la confirmation');
  }

  if (type === 'liquidite') {
    const cible = enDessous && auDessus
      ? (distAtr(enDessous.price) <= distAtr(auDessus.price) ? enDessous : auDessus)
      : (enDessous || auDessus);
    P.push({ label: 'Amas de liquidité identifié', ok: !!cible,
      detail: cible ? `${cible.type} à ${f2(cible.price)} (${cible.touches} touche(s))` : 'aucun amas' });
    P.push({ label: 'Prix à portée de l’amas', ok: !!cible && distAtr(cible.price) !== null && distAtr(cible.price) < 4,
      detail: cible ? `à ${distPct(cible.price).toFixed(2)} % (${distAtr(cible.price).toFixed(1)}× ATR)`
        : 'aucun amas à portée' });
    P.push({ label: 'Session où la liquidité est prise', ok: killActive || sessionActive,
      detail: se.killZone || 'aucune kill zone ouverte' });

    etape(1, 'Amas repéré', !!cible, cible ? `${cible.type} ${f2(cible.price)}` : null);
    etape(2, 'Prix qui s’en approche', !!cible && distAtr(cible.price) < 4,
      cible ? `${distAtr(cible.price).toFixed(1)}× ATR` : null);
    etape(3, 'Balayage effectif (mèche au-delà)', sw.length > 0,
      balayageRecent ? `${balayageRecent.type} (${f2(balayageRecent.depth)} % au-delà)` : 'pas encore');
    etape(4, 'Retour dans le range', !!balayageRecent && !!balayageRecent.reclaimed,
      balayageRecent && balayageRecent.reclaimed ? 'niveau repris' : 'en attente');
    etape(5, 'Structure cassée (BOS / CHoCH)', !!st.event,
      st.event ? `${st.event.type} ${f2(st.event.level)}` : 'aucune cassure');
  }

  if (type === 'intraday') {
    P.push({ label: 'Tendance définie sur 1 h', ok: trend === 'bullish' || trend === 'bearish',
      detail: `tendance ${trend || 'indéfinie'}` });
    P.push({ label: 'Session ouverte', ok: sessionActive,
      detail: se.sessionCourante || '—' });
    P.push({ label: 'Range de travail clair', ok: Number.isFinite(pd.high) && Number.isFinite(pd.low),
      detail: Number.isFinite(pd.high) ? `${f2(pd.low)} – ${f2(pd.high)}` : 'range non identifiable' });

    etape(1, 'Contexte directionnel', trend === 'bullish' || trend === 'bearish', `tendance ${trend}`);
    etape(2, 'Zone réactive identifiée', zones.length > 0,
      zoneProche ? `la plus proche à ${zoneDistanceAtr !== null ? zoneDistanceAtr.toFixed(1) + '× ATR' : '—'}` : 'aucune');
    etape(3, 'Prix du bon côté du range',
      (trend === 'bullish' && pd.position === 'discount') || (trend === 'bearish' && pd.position === 'premium'),
      `prix en ${pd.position || '—'} (équilibre ${f2(pd.equilibrium)})`);
    etape(4, 'Réaction sur la zone', !!zoneProche && zoneDistanceAtr !== null && zoneDistanceAtr < 0.6,
      zoneDistanceAtr !== null ? `${zoneDistanceAtr.toFixed(2)}× ATR` : null);
    etape(5, 'Alignement 5 m / 15 m / 1 h', null, 'vérifié par la confluence');
  }

  if (type === 'swing') {
    P.push({ label: 'Tendance de fond définie', ok: trend === 'bullish' || trend === 'bearish',
      detail: `tendance ${trend || 'indéfinie'}` });
    P.push({ label: 'Prix en discount (achat) ou premium (vente)', ok: pd.position === 'premium' || pd.position === 'discount',
      detail: `prix en ${pd.position || '—'} (équilibre ${f2(pd.equilibrium)})` });
    P.push({ label: 'Niveaux de période disponibles',
      ok: Number.isFinite(pl.PDH) || Number.isFinite(pl.PWH),
      detail: Number.isFinite(pl.PWH) ? `semaine ${f2(pl.PWL)}–${f2(pl.PWH)}`
        : 'niveaux de période indisponibles sur cette unité de temps' });

    etape(1, 'Tendance de fond', trend === 'bullish' || trend === 'bearish', `tendance ${trend}`);
    etape(2, 'Position dans le range large', pd.position === 'premium' || pd.position === 'discount',
      `${pd.position || '—'} · OTE ${pd.ote ? f2(pd.ote.deep) + '–' + f2(pd.ote.shallow) : '—'}`);
    etape(3, 'Zone sur unité supérieure', zones.length > 0,
      `${zones.length} zone(s) identifiée(s)`);
    etape(4, 'Réaction sur la zone', !!zoneProche && zoneDistanceAtr !== null && zoneDistanceAtr < 2,
      zoneDistanceAtr !== null ? `${zoneDistanceAtr.toFixed(1)}× ATR` : null);
    etape(5, 'Alignement 1 h / 4 h / 1 j', null, 'vérifié par la confluence');
  }

  const prerequisOk = P.filter(p => p.ok).length;
  const etapesEvaluees = E.filter(e => e.ok !== null);
  const etapesOk = etapesEvaluees.filter(e => e.ok).length;
  const pret = prerequisOk === P.length && etapesEvaluees.length > 0
    && etapesOk === etapesEvaluees.length;

  // Le premier point qui bloque : c'est lui qu'on annonce.
  const premierManque = P.find(p => !p.ok) || E.find(e => e.ok === false) || null;
  let avancement;
  if (prerequisOk < P.length) {
    avancement = 'contexte incomplet';
  } else if (etapesEvaluees.length && etapesOk === etapesEvaluees.length) {
    avancement = 'toutes les étapes franchies — signal valable pour ce type';
  } else {
    avancement = `étape ${(premierManque && premierManque.numero) || (etapesOk + 1)} sur ${E.length}`;
  }

  return {
    type: t.id, nom: t.nom, duree: t.duree, risque: t.risque, quand: t.quand,
    timeframes: t.timeframes,
    prerequis: P, etapes: E,
    prerequisOk, prerequisTotal: P.length,
    etapesOk, etapesEvaluees: etapesEvaluees.length, etapesTotal: E.length,
    pret, avancement,
    blocage: premierManque ? (premierManque.label || null) : null,
    detailBlocage: premierManque ? (premierManque.detail || null) : null
  };
}

/** Évalue les quatre playbooks : de quoi comparer et choisir sans se contredire. */
function tous(r) {
  return ['scalping', 'liquidite', 'intraday', 'swing'].map(t => evaluer(r, t));
}

module.exports = { TYPES, evaluer, tous };
