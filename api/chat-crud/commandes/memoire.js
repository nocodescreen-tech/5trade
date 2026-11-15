/**
 * Chat CRUD — Commandes MÉMOIRE.
 * Verbes : MONTRE (croyances, faits, exceptions), CRÉE (exception), SUPPRIME (exception).
 */

const Memoire = require('../../memoire');
const { extraireException } = require('../parseur');

async function etat(sujet, ctx) {
  const texte = await NarrateurEtat();
  return { texte };
}

async function NarrateurEtat() {
  const Narrateur = require('../../apprentissage/narrateur');
  return await Narrateur.expliquerEtat();
}

async function lister(sujet, ctx) {
  // Distinguer croyances / faits / exceptions
  if (/croyance/i.test(sujet)) {
    const items = await Memoire.croyances.lister({ limit: 20 });
    return { items };
  }
  if (/exception|r[èe]gle/i.test(sujet)) {
    const items = await Memoire.exceptions.lister({ activesSeulement: false });
    return { items };
  }
  // défaut : faits
  const instrument = (sujet.match(/(EURUSD|GBPUSD|USDJPY|XAUUSD)/i) || [])[1];
  const items = await Memoire.faits.lister({ instrument: instrument ? instrument.toUpperCase() : null, limit: 20 });
  return { items };
}

async function creerException(sujet, ctx) {
  const exc = extraireException(sujet);
  if (!exc) {
    return {
      erreur: 'syntaxe : « crée une exception : ne pas trader EURUSD vendredi après 16h »',
      raison: 'je n\'ai pas reconnu l\'instrument, le jour ou l\'heure'
    };
  }
  const r = await Memoire.exceptions.creer(exc);
  if (!r.ok) return { erreur: 'création échouée', raison: r.raison };
  return { ok: true, id: r.id, raison: `exception créée : ${exc.titre}` };
}

async function supprimerException(sujet, ctx) {
  const m = sujet.match(/exception\s+([\w_-]+)/i);
  if (!m) return { erreur: 'quelle exception ?' };
  const id = m[1];
  await Memoire.exceptions.desactiver(id);
  return { ok: true, id, raison: 'exception désactivée' };
}

module.exports = { etat, lister, creerException, supprimerException };
