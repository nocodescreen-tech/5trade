/**
 * Market Intelligence — profil de marché.
 *
 * Assemble ce que l'on sait d'un instrument à un instant donné : sa famille, son
 * régime, sa session, et la tolérance de spread de sa classe. Le profil expose
 * `pret` et `manques` : un moteur ne doit pas analyser un instrument dont le
 * profil n'est pas établi.
 */

const { classifier } = require('./instrument-classifier');
const { detecter } = require('./regime-detector');
const { aSessions, aActualites, aVolume, profilClasse } = require('./profils-classes');

/** Sessions indicatives en UTC (les horaires réels varient selon le courtier). */
const SESSIONS = [
  { nom: 'asie', debut: 0, fin: 8 },
  { nom: 'londres', debut: 7, fin: 16 },
  { nom: 'new york', debut: 13, fin: 22 }
];

/**
 * Spread maximal toléré, par classe, exprimé en part de l'ATR (donc comparable
 * entre instruments). Valeurs provisoires, versionnées : elles devront être
 * recalibrées par instrument avec les coûts réels du courtier.
 */
const SPREAD_MAX_ATR = {
  forex: 0.08,
  indices: 0.06,
  metaux: 0.10,
  energies: 0.12,
  crypto: 0.15,
  synthetique: 0.05,
  inconnu: null
};

function sessionsActives(maintenant = new Date()) {
  const h = maintenant.getUTCHours();
  return SESSIONS.filter(s => h >= s.debut && h < s.fin).map(s => s.nom);
}

/**
 * @param {string} symbol
 * @param {Array} bougies bougies clôturées (peut être vide : le régime sera UNKNOWN)
 * @param {object} [meta] métadonnées fournisseur
 * @param {{maintenant?:Date}} [options]
 */
function profil(symbol, bougies, meta = {}, options = {}) {
  const instrument = classifier(symbol, meta);
  // La classe de l'instrument choisit ses seuils de régime : un R_10 et un
  // XAUUSD ne se lisent pas avec les mêmes tolérances.
  const regime = detecter(bougies || [], { instrument, classe: instrument.classe });
  const maintenant = options.maintenant || new Date();
  const sessions = aSessions(instrument.classe) ? sessionsActives(maintenant) : ['24h/24'];

  const manques = [];
  if (!instrument.reconnu) manques.push('instrument non identifié : profil impossible');
  if (regime.regime === 'UNKNOWN') manques.push(`régime non déterminable (${regime.raison})`);
  if (!sessions.length) manques.push('hors session de cotation');

  const spreadMaxAtr = SPREAD_MAX_ATR[instrument.classe];
  if (spreadMaxAtr === null) manques.push('tolérance de spread non établie pour cette classe');

  return {
    instrument,
    // Ce que la classe autorise : séances, actualités, volume exploitable.
    actualites: aActualites(instrument.classe),
    volume: aVolume(instrument.classe),
    profil: profilClasse(instrument.classe).etat,
    regime: { regime: regime.regime, confiance: regime.confiance, mesures: regime.mesures,
      classe: regime.classe, seuils: regime.seuils, raison: regime.raison },
    sessions,
    spreadMaxAtr,
    pret: manques.length === 0,
    manques,
    at: maintenant.toISOString()
  };
}

module.exports = { profil, sessionsActives, SPREAD_MAX_ATR, SESSIONS };
