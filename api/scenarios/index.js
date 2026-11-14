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
async function genererEtEnregistrer(candles, meta = {}, options = {}) {
  const r = generateur.generer(candles, meta, options);
  const ids = [];
  for (const s of r.scenarios) {
    const c = await registre.creer(s);
    if (c.ok) ids.push(c.id);
  }
  return {
    crees: ids.length, ids, motif: r.motif, atr: r.atr, prix: r.prix,
    alignement: r.alignement || null
  };
}

/** Alignement H4/D1 pour un instrument, à partir de son historique H1. */
const CACHE_ALIGNEMENT = new Map();          // symbole → { at, valeur }
const TTL_ALIGNEMENT_MS = 5 * 60 * 1000;     // le H4 ne change pas toutes les 10 s

async function alignement(symbol, market, count = 800, options = {}) {
  const cle = String(symbol || '').toUpperCase();
  const cache = CACHE_ALIGNEMENT.get(cle);
  if (!options.force && cache && (Date.now() - cache.at) < TTL_ALIGNEMENT_MS) {
    return { ...cache.valeur, cache: true };
  }
  const valeur = await calculerAlignement(symbol, market, count);
  CACHE_ALIGNEMENT.set(cle, { at: Date.now(), valeur });
  return valeur;
}

async function calculerAlignement(symbol, market, count = 800) {
  const Alignement = require('../regime/alignment-htf');
  try {
    const { candles } = await market.getCandles(symbol, '1h', count);
    let h1 = (candles || []).filter(c => c.closed !== false);

    // Le flux ne sert que ~150 bougies H1 : six blocs D1, donc « D1 inconnu » et
    // aucun filtre utilisable. L'historique long déjà téléchargé (data/historique)
    // complète la série — mêmes bougies, autre fenêtre. On fusionne par horodatage.
    try {
      const H = require('../sources/historique');
      const locaux = H.charger(H.sourcePour(symbol), symbol, '1h') || [];
      const parT = new Map();
      for (const c of locaux) if (c && Number.isFinite(c.t)) parT.set(c.t, c);
      for (const c of h1) if (c && Number.isFinite(c.t)) parT.set(c.t, c);   // le direct gagne
      const fusion = [...parT.values()].sort((a, b) => a.t - b.t);
      if (fusion.length > h1.length) h1 = fusion.slice(-1600);
    } catch { /* pas d'historique local : on travaille avec ce qu'on a, et on le dit */ }

    if (h1.length < 120) {
      return { H4: 'inconnu', D1: 'inconnu', direction: 'neutre', aligne: false,
        resume: `historique insuffisant (${h1.length} H1) pour mesurer H4+D1`, motifs: [], bougies: h1.length };
    }
    return { ...Alignement.aligner({ h1 }), bougies: h1.length };
  } catch (e) {
    return { H4: 'inconnu', D1: 'inconnu', direction: 'neutre', aligne: false,
      resume: `alignement indisponible : ${e.message}`, motifs: [], bougies: 0 };
  }
}

module.exports = {
  init: registre.init,
  creer: registre.creer,
  lister: registre.lister,
  changerStatut: registre.changerStatut,
  expirer: registre.expirer,
  generer: generateur.generer,
  genererEtEnregistrer,
  alignement
};
