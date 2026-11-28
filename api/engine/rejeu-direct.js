/**
 * REJEU FIDÈLE DU DIRECT — le backtest qui appelle le VRAI moteur de décision.
 *
 * Défaut mesuré par trois audits successifs : `engine/backtest.js` appelait
 * `Multi.detecterTout()` puis simulait des sorties. Il ne rejouait ni la
 * validation, ni l'alignement MTF, ni les frais, ni le risque, ni l'arbitrage.
 * Ses statistiques ne décrivaient donc pas ce que le direct aurait fait — elles
 * décrivaient un autre système, plus permissif.
 *
 * Ici, chaque pas de temps appelle `DecisionEngine.decider()` sur la fenêtre que
 * le direct aurait eue. Un trade n'existe que si le moteur l'aurait publié, avec
 * SES niveaux. La sortie est évaluée par `JournalSignaux.evaluer`, la même
 * fonction que le suivi réel, frais déduits.
 *
 * Coût : une décision complète par pas. C'est cher, et c'est le prix de la
 * fidélité — un rejeu approximatif ne prouve rien.
 */

const DecisionEngine = require('./DecisionEngine');
const JournalSignaux = require('./journal-signaux');

/**
 * @param {Array}  candles  série complète (attendu : triée, bougies clôturées)
 * @param {object} meta     { symbol, timeframe }
 * @param {object} opts     options transmises au moteur (profils, confluence…)
 * @param {object} reglages { fenetre=300, pas=5, maxEtapes=200, optionsDecision }
 */
function rejouer(candles, meta, opts = {}, reglages = {}) {
  const serie = (candles || []).filter(c => c && c.closed !== false).sort((a, b) => a.t - b.t);
  const fenetre = Math.max(60, Number(reglages.fenetre) || 300);
  const pas = Math.max(1, Number(reglages.pas) || 5);
  const maxEtapes = Math.max(1, Number(reglages.maxEtapes) || 200);

  const trades = [];
  const etapes = [];
  let i = fenetre - 1;
  let n = 0;

  // Validation stricte de la stratégie demandée
  const optionsGlobales = Object.assign({}, opts, reglages.optionsDecision);
  const profils = Array.isArray(optionsGlobales.profils) ? optionsGlobales.profils.filter(Boolean) : [];
  let strategieExecutee = profils.length === 1 ? {id:profils[0].id,titre:profils[0].titre,version:profils[0].version || null} : null;
  if (optionsGlobales.strategie) {
    const nomStrat = typeof optionsGlobales.strategie === 'string'
      ? optionsGlobales.strategie
      : (optionsGlobales.strategie.id || optionsGlobales.strategie.titre || optionsGlobales.strategie.nom);
    const stratsValides = ['defaut', 'SMC', 'smc', 'SMC_Institutionnel', 'smc_institutionnel', 'retour-moyenne', 'breakout'];
    const estValide = stratsValides.includes(nomStrat)
      || (Array.isArray(optionsGlobales.profils) && optionsGlobales.profils.some(p => p.id === nomStrat || p.titre === nomStrat));
    if (!estValide) {
      return {
        ok: false,
        error: `Stratégie « ${nomStrat} » inconnue ou incompatible avec cet instrument`,
        trades: [],
        etapes: [],
        stats: { rTotal: 0, tauxReussite: 0, esperance: 0 },
        strategieExecutee: null
      };
    }
    const choisi = profils.find(p=>p.id === nomStrat || p.titre === nomStrat);
    strategieExecutee = choisi ? {id:choisi.id,titre:choisi.titre,version:choisi.version || null} : null;
    if (choisi) optionsGlobales.profils = [choisi];
  }

  // SIMULATION HISTORIQUE STRICTE DU RISQUE & DU CAPITAL
  // On ne lit pas l'état du journal présent : on reconstruit le capital,
  // l'exposition cumulée et les positions ouvertes au fil de l'eau pour chaque pas historique.
  const Risque = require('../risk/risque');
  const cfgRisque = Risque.configuration();
  const capitalDepart = Number(reglages.initialCapital ?? opts.capital ?? cfgRisque.capital);
  if (!Number.isFinite(capitalDepart) || capitalDepart <= 0) throw new Error('Capital initial invalide');
  let capitalHistorique = capitalDepart;
  const risquePct = Math.min(Number(reglages.riskPct ?? opts.risquePct ?? cfgRisque.risquePct),cfgRisque.maxRisqueTradePct);
  if (!Number.isFinite(risquePct) || risquePct <= 0) throw new Error('Risque de simulation invalide');
  const plafondRisquePct = Number(reglages.plafondRisquePct || cfgRisque.maxRisqueTotalPct);
  const maxPositionsSimultanees = Number(reglages.maxPositions || cfgRisque.maxSimultanes);

  let positionsActives = []; // { id, symbol, sens, risquePct, montantRisque, clotureAt, evalue }
  let expositionMaxPct = 0;
  let positionsMaxSimultanees = 0;
  let peakCapital = capitalDepart;
  let maxDrawdownPct = 0;

  while (i < serie.length - 1 && n < maxEtapes) {
    n++;
    const tempsActuel = serie[i].t;

    // Dénouement au fil de l'eau des positions arrivées à terme avant ou à tempsActuel
    const encoreOuvertes = [];
    for (const pos of positionsActives) {
      if (pos.clotureAt !== null && pos.clotureAt <= tempsActuel) {
        const pnlMontant = (Number(pos.evalue.r) || 0) * pos.montantRisque;
        capitalHistorique = Math.max(0, +(capitalHistorique + pnlMontant).toFixed(2));
        if (capitalHistorique > peakCapital) peakCapital = capitalHistorique;
        const dd = peakCapital > 0 ? ((peakCapital - capitalHistorique) / peakCapital) * 100 : 0;
        if (dd > maxDrawdownPct) maxDrawdownPct = +dd.toFixed(2);
      } else {
        encoreOuvertes.push(pos);
      }
    }
    positionsActives = encoreOuvertes;

    // Calcul de l'exposition cumulée en cours
    const risqueCumuleOuvert = positionsActives.reduce((s, p) => s + p.risquePct, 0);
    if (risqueCumuleOuvert > expositionMaxPct) expositionMaxPct = +risqueCumuleOuvert.toFixed(2);
    if (positionsActives.length > positionsMaxSimultanees) positionsMaxSimultanees = positionsActives.length;

    const fen = serie.slice(Math.max(0, i - fenetre + 1), i + 1);

    // Vérificateur de risque dynamique recalculé sur l'état HISTORIQUE exact à l'instant t
    const optionsPas = {...optionsGlobales};
    if (!optionsPas.verificateurRisque && !optionsPas.sansRisqueCompte) {
      optionsPas.verificateurRisque = (contrat) => {
        const montantRisqueTrade = (capitalHistorique * risquePct) / 100;
        const e = Number(contrat.entree), s = Number(contrat.stop);
        const dist = Math.abs(e - s);
        if (!Number.isFinite(dist) || dist <= 0) {
          return { ok: false, refus: ['distance stop loss invalide ou nulle'] };
        }
        if (capitalHistorique <= 0) {
          return { ok: false, refus: ['capital historique épuisé (drawdown maximal)'] };
        }
        if (positionsActives.length >= maxPositionsSimultanees) {
          return { ok: false, refus: [`nombre maximal de positions simultanées atteint (${maxPositionsSimultanees})`] };
        }
        if ((risqueCumuleOuvert + risquePct) > plafondRisquePct) {
          return { ok: false, refus: [`plafond d'exposition du portefeuille dépassé (${(risqueCumuleOuvert + risquePct).toFixed(1)}% > ${plafondRisquePct}%)`] };
        }
        // Pas de cumul non maîtrisé sur le même marché
        const memeMarche = positionsActives.filter(p => p.symbol === meta.symbol);
        if (memeMarche.length > 0) {
          return { ok: false, refus: [`position déjà active sur ${meta.symbol} : cumul non autorisé`] };
        }
        return { ok: true, taille: +(montantRisqueTrade / dist).toFixed(2), montant: montantRisqueTrade };
      };
    }

    let verdict = null;
    let erreur = null;
    try {
      const metaPas = Object.assign({}, meta, { at: tempsActuel, date: tempsActuel, time: tempsActuel });
      verdict = DecisionEngine.decider(fen, metaPas, Object.assign({}, optionsPas, { date: tempsActuel }));
    } catch (e) { erreur = e.message; }

    etapes.push({
      at: serie[i].t,
      decision: verdict ? verdict.decision : null,
      signaux: verdict && verdict.signaux ? verdict.signaux.length : 0,
      erreur
    });

    // P0 : Vérification stricte d'exécutabilité et de risque sur le rejeu fidèle.
    // Un verdict ACHAT ou VENTE ne doit être rejoué QUE si le signal porte executable === true
    // ET que le risque a été formellement validé (ou simulation avec garde-fou simulé).
    const s = verdict && verdict.signal;
    const estExecutable = s && (s.executable === true || (verdict.signauxRetenus || []).some(x => x.id === s.id && x.executable === true));
    const risqueValide = verdict && verdict.risque && verdict.risque.ok === true;
    const modeSansRisque = optionsPas.sansRisqueCompte === true;
    const autorise = estExecutable && (risqueValide || modeSansRisque);

    if (verdict && s && (verdict.decision === 'ACHAT' || verdict.decision === 'VENTE') && autorise) {
      const sig = {
        cle: `rejeu:${meta.symbol}:${serie[i].t}`,
        id: `rejeu:${serie[i].t}`,
        symbol: meta.symbol,
        timeframe: meta.timeframe,
        sens: s.sens === 'long' ? 'long' : (s.sens === 'short' ? 'short' : null),
        entree: s.levels ? s.levels.entry : s.entree,
        stop: s.levels ? s.levels.stop : s.stop,
        objectifs: (s.levels && (s.levels.objectifs || s.levels.targets)) || s.objectifs || [],
        at: serie[i].t,
        statut: 'confirme'
      };
      // La sortie est évaluée par la MÊME fonction que le suivi réel : pas de
      // second simulateur, donc pas de seconde vérité.
      const evalue = JournalSignaux.evaluer(sig, serie);
      const bougiesSuivies = Math.max(1, Number(evalue.bougiesSuivies) || 1);
      const idxCloture = Math.min(serie.length - 1, i + bougiesSuivies);
      const clotureAt = evalue.resultat !== 'ouvert' && Number.isFinite(evalue.leveLe) ? evalue.leveLe : null;
      const montantRisqueTrade = (capitalHistorique * risquePct) / 100;

      positionsActives.push({
        id: sig.id,
        symbol: meta.symbol,
        sens: sig.sens,
        risquePct,
        montantRisque: montantRisqueTrade,
        clotureAt,
        evalue
      });

      expositionMaxPct = Math.max(expositionMaxPct,risqueCumuleOuvert + risquePct);
      positionsMaxSimultanees = Math.max(positionsMaxSimultanees,positionsActives.length);
      trades.push({
        at: sig.at,
        clotureAt,
        sens: sig.sens,
        entree: sig.entree,
        stop: sig.stop,
        objectifs: sig.objectifs,
        resultat: evalue.resultat,
        rBrut: evalue.rBrut,
        rNet: evalue.r,
        coutR: evalue.cout ? evalue.cout.enR : 0,
        bougiesSuivies: evalue.bougiesSuivies || 0,
        // Fidélité : ce trade vient du moteur, pas d'un détecteur parallèle.
        source: 'DecisionEngine.decider'
      });

      // On avance après la sortie : le direct ne cumule pas deux positions sur
      // le même marché. Sans ce saut, un même mouvement produisait 10 trades.
      i += Math.max(pas, Number(evalue.bougiesSuivies) || pas);
      continue;
    }
    i += pas;
  }

  // Book each closed position exactly once; unresolved positions remain open.
  for (const pos of positionsActives) {
    if (pos.clotureAt === null) continue;
    const pnlMontant = (Number(pos.evalue.r) || 0) * pos.montantRisque;
    capitalHistorique = Math.max(0, +(capitalHistorique + pnlMontant).toFixed(2));
    peakCapital = Math.max(peakCapital,capitalHistorique);
    maxDrawdownPct = Math.max(maxDrawdownPct,peakCapital > 0 ? +((peakCapital-capitalHistorique)/peakCapital*100).toFixed(2) : 0);
  }

  const baseStats = statistiques(trades);
  const statsFinales = Object.assign(baseStats, {
    capitalInitial: capitalDepart,
    capitalFinal: capitalHistorique,
    maxDrawdownPct,
    expositionMaxPct,
    positionsMaxSimultanees,
    positionsNonCloturees:positionsActives.filter(p=>p.clotureAt === null).length
  });

  return { trades, etapes, stats: statsFinales, strategieExecutee };
}

function statistiques(trades) {
  const avecR = trades.filter(t => t.resultat !== 'ouvert' && Number.isFinite(t.rNet));
  const brut = trades.filter(t => t.resultat !== 'ouvert' && Number.isFinite(t.rBrut));
  const somme = (l, k) => +l.reduce((a, b) => a + Number(b[k] || 0), 0).toFixed(2);
  const gagnants = avecR.filter(t => t.rNet > 0).length;
  return {
    n: trades.length,
    avecR: avecR.length,
    gagnants,
    nbGagnants: gagnants,
    nbPerdants: avecR.length - gagnants,
    tauxReussite: avecR.length ? +(100 * gagnants / avecR.length).toFixed(1) : null,
    rBrut: brut.length ? somme(brut, 'rBrut') : null,
    rNet: avecR.length ? somme(avecR, 'rNet') : null,
    rTotal: avecR.length ? somme(avecR, 'rNet') : null,
    esperance: avecR.length ? +(somme(avecR, 'rNet') / avecR.length).toFixed(3) : null,
    esperanceBrute: brut.length ? +(somme(brut, 'rBrut') / brut.length).toFixed(3) : null,
    esperanceNette: avecR.length ? +(somme(avecR, 'rNet') / avecR.length).toFixed(3) : null,
    coutTotalR: somme(avecR, 'coutR'),
    fraisRenseignes: avecR.filter(t => Number(t.coutR) > 0).length
  };
}

module.exports = { rejouer, statistiques };
