/**
 * 5trade — taux d'intérêt et écarts entre devises.
 *
 * Les écarts de taux sont un driver majeur des tendances de change.
 * Un écart favorable attire les capitaux et renforce la devise.
 *
 * Sources : API des banques centrales (simplifié)
 */

const { fetchAvecReprise } = require('./reseau');

const CENTRAL_BANKS = {
  EUR: { nom: 'BCE', url: 'https://api.ecb.europa.eu/data/policy-rates/ESTB?format=json' },
  USD: { nom: 'Fed', url: 'https://api.stlouisfed.org/fred/series/observations?series_id=DFF&file_type=json' },
  GBP: { nom: 'BoE', url: 'https://www.bankofengland.co.uk/boeapps/database/fromshowcolumns.asp?Travel=NIxSUx&FromSeries=1&ToSeries=50&DA=T&VFD=Y&csv.x=yes' },
  JPY: { nom: 'BoJ', url: 'https://www.boj.or.jp/en/statistics/market/short/mutanet/index.htm/' },
  AUD: { nom: 'RBA', url: 'https://www.rba.gov.au/statistics/tables/xls/f01hist.xls' },
  CAD: { nom: 'BoC', url: 'https://www.bankofcanada.ca/valet/observations/group/INTEREST_RATES/csv' },
  CHF: { nom: 'SNB', url: 'https://www.snb.ch/en/the-snb/monetary-policy/monetary-policy-instruments/interest-rates' },
  NZD: { nom: 'RBNZ', url: 'https://www.rbnz.govt.nz/statistics/series/economic-indicators/interest-rates-and-exchange-rates' }
};

/**
 * Récupère les taux d'intérêt actuels pour toutes les devises.
 *
 * @returns {Promise<Object<string, { taux: number, banque: string, date: string }>>}
 */
async function getTauxInteret() {
  const taux = {};

  // Taux approximatifs (à remplacer par des appels API réels)
  const tauxApproximatifs = {
    EUR: { taux: 4.50, banque: 'BCE' },
    USD: { taux: 5.50, banque: 'Fed' },
    GBP: { taux: 5.25, banque: 'BoE' },
    JPY: { taux: 0.10, banque: 'BoJ' },
    AUD: { taux: 4.35, banque: 'RBA' },
    CAD: { taux: 5.00, banque: 'BoC' },
    CHF: { taux: 1.75, banque: 'SNB' },
    NZD: { taux: 5.50, banque: 'RBNZ' }
  };

  for (const [devise, data] of Object.entries(tauxApproximatifs)) {
    taux[devise] = {
      taux: data.taux,
      banque: data.banque,
      date: new Date().toISOString().split('T')[0]
    };
  }

  return taux;
}

/**
 * Calcule les écarts de taux entre deux devises.
 *
 * @param {string} devise1 - Première devise (ex: 'EUR')
 * @param {string} devise2 - Deuxième devise (ex: 'USD')
 * @param {Object} taux - Résultat de getTauxInteret()
 * @returns {number} Écart de taux en points de base (100 = 1 %)
 */
function ecartTaux(devise1, devise2, taux) {
  if (!taux[devise1] || !taux[devise2]) return 0;
  return +((taux[devise1].taux - taux[devise2].taux) * 100).toFixed(0);
}

/**
 * Détermine si l'écart de taux est favorable à une devise.
 *
 * @param {string} devise - Devise à analyser
 * @param {Object} taux - Résultat de getTauxInteret()
 * @returns {{ favorable: boolean, ecart: number, detail: string }}
 */
function analyseTaux(devise, taux) {
  if (!taux[devise]) return { favorable: false, ecart: 0, detail: 'taux indisponible' };

  // Comparer avec le USD (référence mondiale)
  const ecart = ecartTaux(devise, 'USD', taux);
  const favorable = ecart > 0;

  return {
    favorable,
    ecart,
    detail: `écart avec USD : ${ecart > 0 ? '+' : ''}${ecart} points de base — ${favorable ? 'favorable' : 'défavorable'} à ${devise}`
  };
}

/**
 * Classe les devises par taux d'intérêt (du plus élevé au plus bas).
 *
 * @param {Object} taux - Résultat de getTauxInteret()
 * @returns {Array<{ devise: string, taux: number }>}
 */
function classeTaux(taux) {
  return Object.entries(taux)
    .map(([devise, data]) => ({ devise, taux: data.taux }))
    .sort((a, b) => b.taux - a.taux);
}

module.exports = { getTauxInteret, ecartTaux, analyseTaux, classeTaux };
