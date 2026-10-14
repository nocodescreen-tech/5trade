/**
 * 5trade — COT Report (Commitment of Traders).
 *
 * Le rapport COT est publié chaque vendredi par la CFTC et montre
 * le positionnement des institutionnels sur les futures.
 *
 * Interprétation :
 *   • Positionnement net long extrême → retournement baissier possible
 *   • Positionnement net short extrême → retournement haussier possible
 *   • Les extrêmes de positionnement précèdent souvent les retournements
 */

const { fetchAvecReprise } = require('./reseau');

const COT_URL = 'https://www.cftc.gov/dea/newcot/fut_disagg_txt.html';

/**
 * Récupère les données COT pour un symbole donné.
 *
 * @param {string} symbole - Symbole (ex: 'EUR', 'GBP', 'JPY')
 * @returns {Promise<{ date: number, long: number, short: number, net: number, netPct: number }>}
 */
async function getCOT(symbole) {
  try {
    const res = await fetchAvecReprise(COT_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await res.text();

    // Parsing simplifié — chercher le symbole dans le HTML
    const regex = new RegExp(`${symbole}[^<]*<[^>]*>([\\d,]+)<[^>]*>([\\d,]+)<[^>]*>([\\d,]+)<[^>]*>([\\d,]+)<[^>]*>([\\d,]+)<[^>]*>([\\d,]+)`, 'i');
    const match = html.match(regex);

    if (!match) return null;

    const [, , , , , long, short] = match;
    const longN = parseInt(long.replace(/,/g, '')) || 0;
    const shortN = parseInt(short.replace(/,/g, '')) || 0;
    const net = longN - shortN;
    const total = longN + shortN;
    const netPct = total > 0 ? +((net / total) * 100).toFixed(1) : 0;

    return {
      date: Date.now(),
      long: longN,
      short: shortN,
      net,
      netPct
    };
  } catch (e) {
    console.error('   COT        : échec —', e.message);
    return null;
  }
}

/**
 * Analyse le positionnement COT et détermine s'il est extrême.
 *
 * @param {object} cot - Résultat de getCOT()
 * @returns {{ extrême: boolean, type: 'long'|'short'|null, force: number, detail: string }}
 */
function analyserCOT(cot) {
  if (!cot) return { extrême: false, type: null, force: 0, detail: 'données COT indisponibles' };

  // Un positionnement est extrême si le net dépasse 70 % du total
  if (cot.netPct > 70) {
    return {
      extrême: true,
      type: 'long',
      force: Math.min((cot.netPct - 70) * 2, 100),
      detail: `positionnement net long extrême (${cot.netPct} %) — retournement baissier possible`
    };
  }

  if (cot.netPct < -70) {
    return {
      extrême: true,
      type: 'short',
      force: Math.min((Math.abs(cot.netPct) - 70) * 2, 100),
      detail: `positionnement net short extrême (${cot.netPct} %) — retournement haussier possible`
    };
  }

  return {
    extrême: false,
    type: null,
    force: 0,
    detail: `positionnement net ${cot.netPct > 0 ? 'long' : 'short'} modéré (${cot.netPct} %)`
  };
}

/**
 * Compare le positionnement actuel avec l'historique pour détecter
 * les changements de tendance.
 *
 * @param {Array} historique - Historique des rapports COT
 * @returns {{ tendance: 'long'|'short'|'neutre', variation: number, detail: string }}
 */
function tendanceCOT(historique) {
  if (!historique || historique.length < 2) {
    return { tendance: 'neutre', variation: 0, detail: 'pas assez d\'historique' };
  }

  const last = historique[historique.length - 1];
  const prev = historique[historique.length - 2];
  const variation = last.netPct - prev.netPct;

  let tendance = 'neutre';
  if (variation > 10) tendance = 'long';
  else if (variation < -10) tendance = 'short';

  return {
    tendance,
    variation: +variation.toFixed(1),
    detail: `variation de ${variation.toFixed(1)} % depuis le rapport précédent`
  };
}

module.exports = { getCOT, analyserCOT, tendanceCOT };
