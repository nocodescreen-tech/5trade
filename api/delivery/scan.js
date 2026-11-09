'use strict';

/**
 * Deux niveaux de lecture du marché — à ne pas confondre.
 *
 *  1. SCAN COMPLET (ce module) : tous les symboles, silencieux. Aucune
 *     notification, aucun dédoublonnage : on regarde, on classe, on garde le
 *     résultat à disposition de l'écran. C'est là qu'on inspecte l'univers entier.
 *
 *  2. SURVEILLANCE (delivery/alerts) : liste courte et explicite de marchés,
 *     avec cooldown et anti-doublon, seule autorisée à envoyer un email ou un
 *     push. On n'alerte que sur ce qu'on a choisi de suivre.
 *
 * Mélanger les deux, c'est envoyer quarante notifications par jour : le
 * destinataire coupe les alertes et le système perd toute valeur.
 */

const INTERVALLE_MIN = 15;     // fréquence du scan silencieux
const BOUGIES = 300;           // même fenêtre que la surveillance
const MIN_BOUGIES = 20;        // en dessous, pas d'évaluation honnête

const etat = {
  demarre: false,
  dernier: null,               // { at, tf, marches, signaux, dureeMs }
  timer: null,
  erreurs: []
};

/**
 * Parcourt TOUS les symboles connus et rend les verdicts, sans rien envoyer.
 * @param {{market:object, signals:object, tf?:string, intervalleMin?:number}} deps
 */
async function scanComplet({ market, signals, tf = '15m', intervalleMin = INTERVALLE_MIN } = {}) {
  if (!market || !signals) throw new Error('scan complet : market et signals sont requis');
  const debut = Date.now();
  const symboles = market.listSymbols() || [];
  const signaux = [];
  const erreurs = [];

  for (const s of symboles) {
    const symbole = s.symbol || s.provider || s;
    const provider = s.provider || undefined;
    try {
      const r = await market.getCandles(symbole, tf, BOUGIES, provider);
      const closes = (r.candles || []).filter(c => c.closed !== false);
      if (closes.length < MIN_BOUGIES) {
        erreurs.push(`${symbole} : ${closes.length} bougie(s)`);
        continue;
      }
      const v = signals.detect(closes, { symbol: symbole, timeframe: tf }, {});
      if (!v) continue;
      // On ne garde que ce qui dit quelque chose : un univers entier de
      // « NEUTRE » n'aide personne à décider.
      if (!v.direction || v.direction === 'NEUTRE') continue;
      signaux.push({
        symbole,
        provider: provider || null,
        tf,
        direction: v.direction,
        status: v.status || null,
        force: typeof v.force === 'number' ? v.force : (v.strength || 0),
        trend: v.trend || null,
        confirmations: v.confirmations || 0,
        raison: v.raison || null
      });
    } catch (e) {
      erreurs.push(`${symbole} : ${e.message}`);
    }
  }

  signaux.sort((a, b) => (b.force || 0) - (a.force || 0));
  etat.dernier = {
    at: new Date().toISOString(),
    tf,
    marches: symboles.length,
    signaux: signaux.length,
    dureeMs: Date.now() - debut,
    resultats: signaux
  };
  etat.erreurs = erreurs.slice(0, 20);
  return etat.dernier;
}

/** Démarre le scan silencieux périodique. Idempotent. */
function start(deps) {
  if (etat.demarre) return etat;
  etat.demarre = true;
  const lancer = () => {
    scanComplet(deps).catch(e => {
      etat.erreurs = [e.message];
    });
  };
  lancer();
  etat.timer = setInterval(lancer, (deps.intervalleMin || INTERVALLE_MIN) * 60_000);
  if (etat.timer.unref) etat.timer.unref();
  return etat;
}

function stop() {
  if (etat.timer) clearInterval(etat.timer);
  etat.timer = null;
  etat.demarre = false;
  return etat;
}

/** Dernier scan, pour l'écran : jamais de données inventées si rien n'a tourné. */
function dernierScan() {
  return {
    actif: etat.demarre,
    intervalleMin: INTERVALLE_MIN,
    dernier: etat.dernier,
    erreurs: etat.erreurs
  };
}

module.exports = { scanComplet, start, stop, dernierScan, INTERVALLE_MIN };
