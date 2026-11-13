/**
 * 5trade — SCÉNARIOS : point d'entrée unique.
 *
 *   const Scenarios = require('./scenarios');
 *   await Scenarios.init();                       // table
 *   const { scenarios, motif } = Scenarios.generer(candles, meta);
 *   await Scenarios.creer(s);                     // persiste
 *   await Scenarios.lister({ statut: 'en_attente' });
 *   await Scenarios.expirer();                    // les plans périmés meurent
 */

const registre = require('./registre');
const generateur = require('./generateur');

/**
 * Génère puis enregistre les scénarios d'un instrument.
 * @returns {Promise<{crees:number, motif:string|null, ids:string[]}>}
 */
async function genererEtEnregistrer(candles, meta = {}) {
  const r = generateur.generer(candles, meta);
  const ids = [];
  for (const s of r.scenarios) {
    const c = await registre.creer(s);
    if (c.ok) ids.push(c.id);
  }
  return { crees: ids.length, ids, motif: r.motif, atr: r.atr, prix: r.prix };
}

module.exports = {
  init: registre.init,
  creer: registre.creer,
  lister: registre.lister,
  changerStatut: registre.changerStatut,
  expirer: registre.expirer,
  generer: generateur.generer,
  genererEtEnregistrer
};
