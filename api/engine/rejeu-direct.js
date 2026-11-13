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

  while (i < serie.length - 1 && n < maxEtapes) {
    n++;
    const fen = serie.slice(Math.max(0, i - fenetre + 1), i + 1);
    let verdict = null;
    let erreur = null;
    try {
      verdict = DecisionEngine.decider(fen, meta, reglages.optionsDecision || opts);
    } catch (e) { erreur = e.message; }

    etapes.push({
      at: serie[i].t,
      decision: verdict ? verdict.decision : null,
      signaux: verdict && verdict.signaux ? verdict.signaux.length : 0,
      erreur
    });

    if (verdict && verdict.signal && (verdict.decision === 'ACHAT' || verdict.decision === 'VENTE')) {
      const s = verdict.signal;
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
      trades.push({
        at: sig.at,
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

  return { trades, etapes, stats: statistiques(trades) };
}

function statistiques(trades) {
  const avecR = trades.filter(t => Number.isFinite(t.rNet));
  const brut = trades.filter(t => Number.isFinite(t.rBrut));
  const somme = (l, k) => +l.reduce((a, b) => a + Number(b[k] || 0), 0).toFixed(2);
  const gagnants = avecR.filter(t => t.rNet > 0).length;
  return {
    n: trades.length,
    avecR: avecR.length,
    gagnants,
    tauxReussite: avecR.length ? +(100 * gagnants / avecR.length).toFixed(1) : null,
    rBrut: brut.length ? somme(brut, 'rBrut') : null,
    rNet: avecR.length ? somme(avecR, 'rNet') : null,
    esperanceBrute: brut.length ? +(somme(brut, 'rBrut') / brut.length).toFixed(3) : null,
    esperanceNette: avecR.length ? +(somme(avecR, 'rNet') / avecR.length).toFixed(3) : null,
    coutTotalR: somme(avecR, 'coutR'),
    fraisRenseignes: avecR.filter(t => Number(t.coutR) > 0).length
  };
}

module.exports = { rejouer, statistiques };
