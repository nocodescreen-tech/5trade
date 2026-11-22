/**
 * 5trade — Moteur temporel & Sessions de marché.
 *
 * Détermine avec exactitude si un marché est ouvert, fermé ou en pré-fermeture
 * selon sa classe d'actif (Forex, Métaux, Indices synthétiques, Crypto, etc.).
 *
 * Règles :
 *  - Forex : ferme le vendredi à 22:00 UTC, rouvre le dimanche à 22:00 UTC.
 *  - Métaux (Or/Argent) : ferme le week-end comme le Forex + pause quotidienne 21:00–22:00 UTC.
 *  - Indices synthétiques (Deriv R_*, BOOM, CRASH) : continu 24/7, jamais fermé.
 *  - Crypto (BTC, ETH...) : continu 24/7, jamais fermé.
 *  - Indices réels (US30, SP500, DAX...) : fermés le week-end et hors sessions boursières.
 */

const { classifier } = require('../market-intelligence/instrument-classifier');

/**
 * Détermine si une date UTC tombe pendant l'heure d'été américaine (EDT).
 * Aux États-Unis, l'heure d'été commence le 2e dimanche de mars et se termine le 1er dimanche de novembre.
 * À 17:00 heure de New York :
 *   - En été (EDT / UTC-4) : 17:00 NY = 21:00 UTC.
 *   - En hiver (EST / UTC-5) : 17:00 NY = 22:00 UTC.
 * @param {Date} date
 * @returns {boolean}
 */
function estHeureEteUS(date) {
  const annee = date.getUTCFullYear();
  const mars1 = new Date(Date.UTC(annee, 2, 1));
  const deuxiemeDimancheMars = ((7 - mars1.getUTCDay()) % 7 + 1) + 7;
  const debutEDT = new Date(Date.UTC(annee, 2, deuxiemeDimancheMars, 7, 0, 0));

  const nov1 = new Date(Date.UTC(annee, 10, 1));
  const premierDimancheNov = (7 - nov1.getUTCDay()) % 7 + 1;
  const finEDT = new Date(Date.UTC(annee, 10, premierDimancheNov, 6, 0, 0));

  return date >= debutEDT && date < finEDT;
}

/**
 * Calcule l'état de session d'un instrument à un instant t.
 * @param {string} symbol
 * @param {number|Date} [dateOuTs=Date.now()]
 * @param {object} [options={}]
 * @param {boolean} [options.autoriserInconnu=false]
 * @param {number} [options.fermetureVendrediUTC]
 * @param {number} [options.reouvertureDimancheUTC]
 * @returns {{
 *   ouvert: boolean,
 *   statut: 'ouvert'|'ferme'|'pre_fermeture'|'pause'|'inconnu',
 *   classe: string,
 *   continu: boolean,
 *   weekend: boolean,
 *   raison: string,
 *   prochaineOuverture: Date|null,
 *   prochaineFermeture: Date|null,
 *   dst: boolean
 * }}
 */
function statutMarche(symbol, dateOuTs = Date.now(), options = {}) {
  const d = dateOuTs instanceof Date ? dateOuTs : new Date(Number(dateOuTs));
  const ts = d.getTime();
  const info = classifier(symbol);
  const classe = info.classe || 'inconnu';
  const dst = estHeureEteUS(d);

  // 1. Marchés continus 24h/24, 7j/7
  if (classe === 'synthetique' || classe === 'crypto') {
    return {
      ouvert: true,
      statut: 'ouvert',
      classe,
      continu: true,
      weekend: false,
      raison: `${info.libelle} ouvert 24h/24, 7j/7 (trading continu)`,
      prochaineOuverture: null,
      prochaineFermeture: null,
      dst
    };
  }

  // Jours UTC : 0 = Dimanche, 1 = Lundi, ..., 5 = Vendredi, 6 = Samedi
  const jour = d.getUTCDay();
  const heure = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const tempsMinutes = heure * 60 + minute;

  // Heure de clôture NY : 21:00 UTC en été (EDT), 22:00 UTC en hiver (EST)
  // Surchargeable par le broker si spécifié
  const heureFermetureForex = Number.isFinite(options.fermetureVendrediUTC)
    ? options.fermetureVendrediUTC
    : (dst ? 21 : 22);
  const heureOuvertureForex = Number.isFinite(options.reouvertureDimancheUTC)
    ? options.reouvertureDimancheUTC
    : (dst ? 21 : 22);

  // Calcul du prochain dimanche à l'heure d'ouverture
  function getProchainDimancheOuverture(fromTime) {
    const target = new Date(fromTime);
    target.setUTCMinutes(0, 0, 0);
    target.setUTCHours(heureOuvertureForex);
    const day = target.getUTCDay();
    const diff = (7 - day) % 7;
    target.setUTCDate(target.getUTCDate() + diff);
    if (target.getTime() <= fromTime) {
      target.setUTCDate(target.getUTCDate() + 7);
    }
    return target;
  }

  // Calcul du prochain vendredi à l'heure de fermeture
  function getProchainVendrediFermeture(fromTime) {
    const target = new Date(fromTime);
    target.setUTCMinutes(0, 0, 0);
    target.setUTCHours(heureFermetureForex);
    const day = target.getUTCDay();
    let diff = 5 - day;
    if (diff < 0 || (diff === 0 && target.getTime() <= fromTime)) {
      diff += 7;
    }
    target.setUTCDate(target.getUTCDate() + diff);
    return target;
  }

  // 2. Forex et Métaux
  if (classe === 'forex' || classe === 'metaux' || classe === 'energies') {
    const estVendrediApresFermeture = (jour === 5 && tempsMinutes >= heureFermetureForex * 60);
    const estSamedi = (jour === 6);
    const estDimancheAvantOuverture = (jour === 0 && tempsMinutes < heureOuvertureForex * 60);
    const estWeekend = estVendrediApresFermeture || estSamedi || estDimancheAvantOuverture;

    if (estWeekend) {
      const reouverture = getProchainDimancheOuverture(ts);
      return {
        ouvert: false,
        statut: 'ferme',
        classe,
        continu: false,
        weekend: true,
        raison: `Marché ${info.libelle} fermé le week-end (fermeture vendredi ${heureFermetureForex}:00 UTC, réouverture dimanche ${heureOuvertureForex}:00 UTC${dst ? ' · heure d\'été EDT' : ''})`,
        prochaineOuverture: reouverture,
        prochaineFermeture: null,
        dst
      };
    }

    // Pré-fermeture du vendredi soir (dernière heure avant clôture)
    if (jour === 5 && tempsMinutes >= (heureFermetureForex - 1) * 60 && tempsMinutes < heureFermetureForex * 60) {
      return {
        ouvert: true,
        statut: 'pre_fermeture',
        classe,
        continu: false,
        weekend: false,
        raison: `Marché ${info.libelle} en phase de pré-fermeture du week-end (clôture à ${heureFermetureForex}:00 UTC) : risque de slippage et spreads élargis`,
        prochaineOuverture: null,
        prochaineFermeture: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), heureFermetureForex, 0, 0)),
        dst
      };
    }

    // Pause quotidienne des métaux (une heure avant réouverture asiatique)
    const pauseMetauxHeure = dst ? 20 : 21;
    if (classe === 'metaux' && jour >= 1 && jour <= 4 && tempsMinutes >= pauseMetauxHeure * 60 && tempsMinutes < (pauseMetauxHeure + 1) * 60) {
      return {
        ouvert: false,
        statut: 'pause',
        classe,
        continu: false,
        weekend: false,
        raison: `Pause de maintenance quotidienne des métaux (${pauseMetauxHeure}:00–${pauseMetauxHeure + 1}:00 UTC)`,
        prochaineOuverture: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), pauseMetauxHeure + 1, 0, 0)),
        prochaineFermeture: null,
        dst
      };
    }

    // Ouvert en semaine normale
    return {
      ouvert: true,
      statut: 'ouvert',
      classe,
      continu: false,
      weekend: false,
      raison: `Marché ${info.libelle} ouvert`,
      prochaineOuverture: null,
      prochaineFermeture: getProchainVendrediFermeture(ts),
      dst
    };
  }

  // 3. Indices réels (actions / indices boursiers)
  if (classe === 'indices') {
    if (jour === 0 || jour === 6) {
      return {
        ouvert: false,
        statut: 'ferme',
        classe,
        continu: false,
        weekend: true,
        raison: `Bourses d'indices fermées le week-end`,
        prochaineOuverture: getProchainDimancheOuverture(ts),
        prochaineFermeture: null,
        dst
      };
    }
    return {
      ouvert: true,
      statut: 'ouvert',
      classe,
      continu: false,
      weekend: false,
      raison: `Marché indices ouvert`,
      prochaineOuverture: null,
      prochaineFermeture: null,
      dst
    };
  }

  // 4. Classe inconnue : PAR DÉFAUT STRICT, UN ÉTAT INCONNU BLOQUE L'EXÉCUTION
  const autoriserInconnu = options.autoriserInconnu === true;
  return {
    ouvert: autoriserInconnu,
    statut: autoriserInconnu ? 'ouvert' : 'inconnu',
    classe: 'inconnu',
    continu: false,
    weekend: (jour === 0 || jour === 6),
    raison: autoriserInconnu
      ? 'Classe d\'instrument inconnue : autorisée explicitement'
      : 'Classe d\'instrument inconnue : session non vérifiée (exécution refusée par sécurité)',
    prochaineOuverture: null,
    prochaineFermeture: null,
    dst
  };
}

module.exports = { statutMarche, verifierSession: statutMarche, estHeureEteUS };
