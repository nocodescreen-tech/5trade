/**
 * 5trade — protection contre les drawdowns.
 *
 * Un système de trading qui continue à prendre des signaux après 5 pertes
 * consécutives n'est pas un système professionnel. Ce module surveille
 * la courbe de equity et ajuste le risque en conséquence :
 *
 *   • 3 pertes consécutives  → risque réduit de 50 %
 *   • 5 pertes consécutives  → risque réduit de 75 %
 *   • drawdown > 10 %        → trades bloqués
 *   • drawdown > 20 %        → trades bloqués + alerte
 *
 * La récupération est progressive : après 2 gains consécutifs,
 * le risque revient à la normale.
 */

/**
 * Calcule le drawdown actuel à partir de la courbe de equity.
 *
 * @param {Array} equityCurve - Historique de l'equity [{ t: number, value: number }]
 * @returns {{ drawdownPct: number, peak: number, current: number, maxDrawdownPct: number }}
 */
function calculerDrawdown(equityCurve) {
  if (!equityCurve || equityCurve.length < 2) {
    return { drawdownPct: 0, peak: 0, current: 0, maxDrawdownPct: 0 };
  }

  let peak = equityCurve[0].value;
  let maxDrawdown = 0;

  for (const point of equityCurve) {
    if (point.value > peak) peak = point.value;
    const dd = peak > 0 ? ((peak - point.value) / peak) * 100 : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const current = equityCurve[equityCurve.length - 1].value;
  const drawdownPct = peak > 0 ? ((peak - current) / peak) * 100 : 0;

  return {
    drawdownPct: +drawdownPct.toFixed(2),
    peak: +peak.toFixed(2),
    current: +current.toFixed(2),
    maxDrawdownPct: +maxDrawdown.toFixed(2)
  };
}

/**
 * Détermine l'ajustement du risque en fonction des pertes consécutives
 * et du drawdown.
 *
 * @param {object} params
 * @param {Array} params.trades - Historique des trades (du plus récent au plus ancien)
 * @param {number} [params.drawdownPct] - Drawdown actuel en %
 * @param {number} [params.risqueNormalPct] - Risque normal en % (défaut: 1)
 * @returns {{ risquePct: number, bloque: boolean, raison: string, niveau: string }}
 */
function ajusterRisque({ trades, drawdownPct = 0, risqueNormalPct = 1 }) {
  // Compter les pertes consécutives (trades les plus récents d'abord)
  let pertesConsecutives = 0;
  for (const t of trades) {
    if (t.result === 'loss') pertesConsecutives++;
    else if (t.result === 'win') break;
    // breakeven ne casse pas la série
  }

  // Compter les gains consécutifs (pour la récupération)
  let gainsConsecutifs = 0;
  for (const t of trades) {
    if (t.result === 'win') gainsConsecutifs++;
    else if (t.result === 'loss') break;
  }

  // BLOQUAGE : drawdown > 20 %
  if (drawdownPct > 20) {
    return {
      risquePct: 0,
      bloque: true,
      raison: `Drawdown ${drawdownPct.toFixed(1)} % > 20 % — trades bloqués`,
      niveau: 'critique'
    };
  }

  // BLOQUAGE : drawdown > 10 %
  if (drawdownPct > 10) {
    return {
      risquePct: 0,
      bloque: true,
      raison: `Drawdown ${drawdownPct.toFixed(1)} % > 10 % — trades bloqués`,
      niveau: 'alerte'
    };
  }

  // RÉDUCTION : 5 pertes consécutives
  if (pertesConsecutives >= 5) {
    return {
      risquePct: +(risqueNormalPct * 0.25).toFixed(3),
      bloque: false,
      raison: `${pertesConsecutives} pertes consécutives — risque réduit à 25 %`,
      niveau: 'reduction'
    };
  }

  // RÉDUCTION : 3 pertes consécutives
  if (pertesConsecutives >= 3) {
    return {
      risquePct: +(risqueNormalPct * 0.5).toFixed(3),
      bloque: false,
      raison: `${pertesConsecutives} pertes consécutives — risque réduit à 50 %`,
      niveau: 'reduction'
    };
  }

  // RÉCUPÉRATION : 2 gains consécutifs après des pertes
  if (gainsConsecutifs >= 2 && pertesConsecutives > 0) {
    return {
      risquePct: risqueNormalPct,
      bloque: false,
      raison: `${gainsConsecutifs} gains consécutifs — risque normal rétabli`,
      niveau: 'normal'
    };
  }

  // NORMAL
  return {
    risquePct: risqueNormalPct,
    bloque: false,
    raison: 'pas de pertes consécutives — risque normal',
    niveau: 'normal'
  };
}

/**
 * Construit la courbe de equity à partir des trades.
 *
 * @param {Array} trades - Trades clôturés [{ closedAt, pnl }]
 * @param {number} capitalInitial - Capital initial
 * @returns {Array} Courbe de equity [{ t: number, value: number }]
 */
function courbeEquity(trades, capitalInitial = 10000) {
  const chrono = [...trades]
    .filter(t => t.status === 'closed' && t.pnl !== null)
    .sort((a, b) => new Date(a.closedAt || 0) - new Date(b.closedAt || 0));

  let equity = capitalInitial;
  const curve = [{ t: Date.now(), value: equity }];

  for (const t of chrono) {
    equity += t.pnl;
    curve.push({ t: new Date(t.closedAt || 0).getTime(), value: +equity.toFixed(2) });
  }

  return curve;
}

module.exports = { calculerDrawdown, ajusterRisque, courbeEquity };
