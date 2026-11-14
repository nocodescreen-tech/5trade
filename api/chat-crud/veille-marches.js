/**
 * 5trade — VEILLE DES MARCHÉS → CONVERSATION.
 *
 * L'IA répondait sur les positions, mais elle ne disait rien des RETOURNEMENTS :
 * un biais qui passe d'acheteur à vendeur, une confirmation qui s'inverse. Un
 * trader ne l'apprend pas en relisant un tableau une heure plus tard.
 *
 * Chaque tour relit les marchés sous surveillance, compare la direction à celle
 * du tour précédent, et publie un événement DANS la conversation seulement si
 * quelque chose a réellement changé. Le premier tour est silencieux : on
 * mémorise l'état de départ au lieu d'annoncer un « retournement » qui n'a pas eu
 * lieu.
 *
 * Aucun chiffre n'est inventé : tout vient des bougies réellement reçues. Un
 * marché sans données est ignoré, et le dit une fois.
 */

const Flux = require('./flux');

const etat = new Map();     // "symbol|tf" → { direction, status, at }
let premierTour = true;
let deps = null;            // { Market, Signals, Alerts } injecté par le serveur

function etatParDefaut() {
  if (deps) return deps;
  deps = {
    Market: require('../sources/market'),
    Signals: require('../engine/signals'),
    Alerts: require('../delivery/alerts')
  };
  return deps;
}

/** Les marchés surveillés : la configuration de la surveillance, sinon rien. */
function marchesSurveilles() {
  const { Alerts } = etatParDefaut();
  const cfg = (Alerts.get && Alerts.get()) || {};
  return Array.isArray(cfg.marches) ? cfg.marches.filter(m => m && m.symbol) : [];
}

const libelle = (direction) => (direction === 'BUY' ? 'acheteur' : direction === 'SELL' ? 'vendeur' : 'neutre');

/**
 * Un tour de veille.
 * @returns {Promise<{marches:number, changements:number, evenements:number}>}
 */
async function tick() {
  const { Market, Signals } = etatParDefaut();
  const liste = marchesSurveilles();
  let changements = 0;
  let evenements = 0;

  for (const m of liste.slice(0, 12)) {
    const cle = `${m.symbol}|${m.tf}`;
    let verdict = null;
    try {
      const r = await Market.getCandles(m.symbol, m.tf, 200, m.provider);
      const closes = (r && r.candles ? r.candles : []).filter(c => c && c.closed !== false);
      if (closes.length < 20) continue;
      verdict = Signals.detect(closes, { symbol: m.symbol, timeframe: m.tf });
    } catch { continue; }   // marché indisponible : on ne devine pas

    if (!verdict) continue;
    const direction = verdict.direction || 'NEUTRAL';
    const status = verdict.status || 'neutre';
    const avant = etat.get(cle);
    etat.set(cle, { direction, status, at: Date.now() });
    if (premierTour) continue;

    const sens = String(verdict.sens || '').toLowerCase();
    const bascule = avant && avant.direction !== direction
      && ['BUY', 'SELL'].includes(direction) && ['BUY', 'SELL'].includes(avant.direction);

    // 1. Retournement : la direction s'inverse réellement.
    if (bascule) {
      changements++;
      const suite = status === 'confirme'
        ? 'signal confirmé par les règles'
        : 'à confirmer sur la clôture suivante';
      await Flux.publier({
        type: 'retournement',
        gravite: status === 'confirme' ? 'warn' : 'info',
        meta: { symbol: m.symbol, timeframe: m.tf, avant: avant.direction,
          apres: direction, status },
        texte: `Retournement — ${m.symbol} ${m.tf} : le biais passe de `
          + `${libelle(avant.direction)} à ${libelle(direction)} (${suite}).`
          + (sens ? ` Direction de travail : ${sens === 'long' ? 'achat' : 'vente'}.` : '')
      });
      evenements++;
      continue;
    }

    // 2. Confirmation d'un sens qui était encore en observation.
    if (avant && avant.direction === direction && avant.status !== 'confirme'
      && status === 'confirme' && ['BUY', 'SELL'].includes(direction)) {
      changements++;
      await Flux.publier({
        type: 'confirmation',
        gravite: 'ok',
        meta: { symbol: m.symbol, timeframe: m.tf, direction, status },
        texte: `Confirmation — ${m.symbol} ${m.tf} : le biais ${libelle(direction)} `
          + `passe de « à surveiller » à « confirmé ».`
      });
      evenements++;
    }
  }

  premierTour = false;
  return { marches: liste.length, changements, evenements };
}

/** Oublie l'état mémorisé (utile après un changement de liste de marchés). */
function reinitialiser() { etat.clear(); premierTour = true; }

/** Ce que la veille a retenu, pour diagnostic. */
function photographie() {
  return [...etat.entries()].map(([cle, v]) => ({ marche: cle, ...v }));
}

module.exports = { tick, reinitialiser, photographie, marchesSurveilles };
