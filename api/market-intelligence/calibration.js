/**
 * Résolution des paramètres par INSTRUMENT, FAMILLE, puis CLASSE.
 *
 * Constat : `profils-classes.js` donne des paramètres au Forex en général.
 * EURUSD et GBPJPY n'ont pourtant pas la même volatilité, les mêmes sessions
 * actives ni les mêmes coûts. Appliquer le profil de classe à tout le monde est
 * juste — mais ce n'est pas une calibration.
 *
 * Ce module ne fabrique AUCUNE valeur. Il résout dans l'ordre :
 *   1. instrument + unité de temps (le plus précis, s'il a été calibré) ;
 *   2. famille d'instruments (volatility / boom-crash / step / 1hz / majeures…) ;
 *   3. classe de marché (le repli d'aujourd'hui).
 * Et il DIT lequel des trois a répondu. Un appelant qui exige une calibration
 * propre à l'instrument peut donc refuser au lieu de croire qu'il en a une.
 */

const { profilClasse } = require('./profils-classes');
const { classifier } = require('./instrument-classifier');

/**
 * Calibrations explicites. VIDE PAR CONSTRUCTION : on n'invente pas des seuils
 * par instrument. Chaque entrée ajoutée ici doit venir d'une mesure reproductible
 * (rapport de backtest daté), pas d'une intuition.
 */
const INSTRUMENTS = {
  // 'EURUSD': { timeframes: { '15m': { ... } } }
};

/** Familles d'instruments à l'intérieur d'une classe. */
const FAMILLES = {
  // Boom/Crash : le résultat vient de sauts, pas d'une structure de prix.
  'synthetique/boom-crash': { note: 'produit à sauts : la lecture chartiste est secondaire' },
  'synthetique/step': { note: 'variation discrète par paliers' },
  'synthetique/1hz': { note: 'série à haute fréquence : la latence domine' },
  'synthetique/volatility': { note: 'processus aléatoire continu' },
  'forex/majeures': { note: 'liquidité et spreads les plus faibles de la classe' },
  'forex/croisees': { note: 'spreads plus larges, corrélations à surveiller' }
};

/** Famille d'un instrument, à partir de son symbole et de sa classe. */
function famille(symbole, classe) {
  const s = String(symbole || '').toUpperCase();
  if (classe === 'synthetique') {
    if (/^(BOOM|CRASH)/.test(s)) return 'boom-crash';
    if (/^(JD)/.test(s)) return 'jump';
    if (/^(STP|STEP)/.test(s)) return 'step';
    if (/^1HZ/.test(s)) return '1hz';
    return 'volatility';
  }
  if (classe === 'forex') {
    const majeures = /^(EURUSD|USDJPY|GBPUSD|USDCHF|AUDUSD|USDCAD|NZDUSD)$/;
    const c = classifier(symbole);
    const code = `${c.deviseBase || ''}${c.deviseCote || ''}`;
    return majeures.test(code) ? 'majeures' : 'croisees';
  }
  return null;
}

/**
 * Paramètres effectifs pour un instrument et une unité de temps.
 * @returns {{parametres:object, source:'instrument'|'famille'|'classe', famille:string|null,
 *            classe:string, calibre:boolean, note:string|null}}
 */
function pour(symbole, { timeframe = null, classe = null } = {}) {
  const inst = classifier(symbole);
  const cl = classe || inst.classe;
  const fam = famille(symbole, cl);
  const base = profilClasse(cl) || null;

  // 1. Instrument + unité de temps
  const parInstrument = INSTRUMENTS[String(symbole || '').toUpperCase()];
  if (parInstrument && timeframe && parInstrument.timeframes && parInstrument.timeframes[timeframe]) {
    return {
      parametres: { ...(base || {}), ...parInstrument.timeframes[timeframe] },
      source: 'instrument', famille: fam, classe: cl, calibre: true,
      note: `paramètres calibrés pour ${symbole} en ${timeframe}`
    };
  }

  // 2. Famille
  const parFamille = fam ? FAMILLES[`${cl}/${fam}`] : null;
  if (parFamille) {
    return {
      parametres: base, source: 'famille', famille: fam, classe: cl, calibre: false,
      note: `aucune calibration propre à ${symbole} : paramètres de la classe ${cl}`
        + (parFamille.note ? ` — ${parFamille.note}` : '')
    };
  }

  // 3. Classe
  return {
    parametres: base, source: 'classe', famille: fam, classe: cl, calibre: false,
    note: `aucune calibration propre à ${symbole} ni à sa famille : paramètres de la classe ${cl}`
  };
}

/** Vue pour l'écran : quelles combinaisons sont réellement calibrées. */
function etat() {
  return {
    instrumentsCalibres: Object.keys(INSTRUMENTS),
    familles: Object.keys(FAMILLES),
    note: Object.keys(INSTRUMENTS).length
      ? null
      : 'aucun instrument n\'est encore calibré : toutes les analyses utilisent le profil de leur classe'
  };
}

module.exports = { pour, famille, etat, INSTRUMENTS, FAMILLES };
