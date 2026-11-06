/**
 * Security — limitation de débit générique.
 *
 * Une route coûteuse (analyse IA, backtest) appelée en boucle épuise le budget API
 * et bloque la surveillance. Le limiteur existant ne couvrait que la connexion.
 *
 * Fenêtre glissante en mémoire, par clé (IP + route). Volontairement simple : pas
 * de dépendance, pas de Redis. Sur plusieurs instances, chaque instance compte
 * séparément — insuffisant pour un cluster, suffisant pour un conteneur unique.
 */

/**
 * @param {object} options { max, fenetreMs, maintenant }
 * @returns {{consommer:Function, etat:Function, reinitialiser:Function}}
 */
function creer(options = {}) {
  const max = Number.isFinite(options.max) ? options.max : 20;
  const fenetreMs = Number.isFinite(options.fenetreMs) ? options.fenetreMs : 60000;
  const horloge = options.maintenant || (() => Date.now());
  const hits = new Map();   // clé -> [timestamps]

  const nettoyer = (cle, t) => {
    const liste = (hits.get(cle) || []).filter(ts => t - ts < fenetreMs);
    if (liste.length) hits.set(cle, liste);
    else hits.delete(cle);
    return liste;
  };

  /**
   * @returns {{autorise:boolean, restant:number, reessayerDansMs:number, max:number}}
   */
  function consommer(cle, cout = 1) {
    const t = horloge();
    const liste = nettoyer(cle, t);
    if (liste.length + cout > max) {
      const plusAncien = liste[0] || t;
      return {
        autorise: false, restant: 0, max,
        reessayerDansMs: Math.max(0, fenetreMs - (t - plusAncien))
      };
    }
    for (let i = 0; i < cout; i++) liste.push(t);
    hits.set(cle, liste);
    return { autorise: true, restant: max - liste.length, reessayerDansMs: 0, max };
  }

  const etat = cle => {
    const t = horloge();
    const liste = nettoyer(cle, t);
    return { consommes: liste.length, restant: Math.max(0, max - liste.length), max, fenetreMs };
  };

  const reinitialiser = cle => { if (cle === undefined) hits.clear(); else hits.delete(cle); };

  return { consommer, etat, reinitialiser, max, fenetreMs };
}

/**
 * Middleware Express : refuse en 429 avec un en-tête Retry-After lisible.
 * La clé combine l'IP et une étiquette de route pour que deux routes n'aient pas
 * à partager le même quota.
 */
function middleware(limiteur, etiquette = 'route', options = {}) {
  const cleDe = options.cle || (req => `${etiquette}:${req.ip || (req.socket && req.socket.remoteAddress) || 'inconnu'}`);
  return (req, res, next) => {
    const r = limiteur.consommer(cleDe(req));
    res.set('X-RateLimit-Limit', String(r.max));
    res.set('X-RateLimit-Remaining', String(r.restant));
    if (!r.autorise) {
      res.set('Retry-After', String(Math.ceil(r.reessayerDansMs / 1000)));
      return res.status(429).json({
        error: `Trop de requêtes sur ${etiquette}. Réessayez dans ${Math.ceil(r.reessayerDansMs / 1000)} s.`,
        retryAfterSec: Math.ceil(r.reessayerDansMs / 1000)
      });
    }
    next();
  };
}

module.exports = { creer, middleware };
