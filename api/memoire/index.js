/**
 * 5trade — Mémoire persistante : point d'entrée unique.
 *
 * Initialise toutes les sous-tables (faits, croyances, exceptions) et expose
 * une API unifiée. À appeler au démarrage du serveur, après DB.init().
 *
 *   const Memoire = require('./memoire');
 *   await Memoire.init();
 *   await Memoire.faits.enregistrer({ ... });
 *   await Memoire.exceptions.creer({ ... });
 */

const faits = require('./faits');
const croyances = require('./croyances');
const exceptions = require('./exceptions');

async function init() {
  const a = await faits.init();
  const b = await croyances.init();
  const c = await exceptions.init();
  return { faits: a, croyances: b, exceptions: c };
}

/** Résumé global pour le dashboard et le chat CRUD. */
async function etat() {
  const f = await faits.stats();
  const c = await croyances.lister({ limit: 1000 });
  const e = await exceptions.lister({ activesSeulement: true });
  const competent = c.filter(x => Number(x.confiance) >= 0.6 && Number(x.expectancy) > 0.15).length;
  const incompetent = c.filter(x => Number(x.confiance) < 0.3 || Number(x.expectancy) < 0).length;
  const moyen = c.length - competent - incompetent;
  return {
    faits: f.total,
    faitsParType: f.parType,
    croyances: c.length,
    competence: { competent, moyen, incompetent, inconnu: c.filter(x => x.trades < 5).length },
    exceptions: e.length,
  };
}

module.exports = { init, etat, faits, croyances, exceptions };
