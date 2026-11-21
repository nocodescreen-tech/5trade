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
 * Calcule l'état de session d'un instrument à un instant t.
 * @param {string} symbol
 * @param {number|Date} [dateOuTs=Date.now()]
 * @returns {{
 *   ouvert: boolean,
 *   statut: 'ouvert'|'ferme'|'pre_fermeture'|'pause',
 *   classe: string,
 *   continu: boolean,
 *   weekend: boolean,
 *   raison: string,
 *   prochaineOuverture: Date|null,
 *   prochaineFermeture: Date|null
 * }}
 */
function statutMarche(symbol, dateOuTs = Date.now()) {
  const d = dateOuTs instanceof Date ? dateOuTs : new Date(Number(dateOuTs));
  const ts = d.getTime();
  const info = classifier(symbol);
  const classe = info.classe || 'inconnu';

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
      prochaineFermeture: null
    };
  }

  // Jours UTC : 0 = Dimanche, 1 = Lundi, ..., 5 = Vendredi, 6 = Samedi
  const jour = d.getUTCDay();
  const heure = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const tempsMinutes = heure * 60 + minute;

  // Calcul du prochain dimanche 22:00 UTC (réouverture Forex/Métaux)
  function getProchainDimanche22h(fromTime) {
    const target = new Date(fromTime);
    target.setUTCMinutes(0, 0, 0);
    target.setUTCHours(22);
    const day = target.getUTCDay();
    const diff = (7 - day) % 7;
    target.setUTCDate(target.getUTCDate() + diff);
    if (target.getTime() <= fromTime) {
      target.setUTCDate(target.getUTCDate() + 7);
    }
    return target;
  }

  // Calcul du prochain vendredi 22:00 UTC (fermeture Forex/Métaux)
  function getProchainVendredi22h(fromTime) {
    const target = new Date(fromTime);
    target.setUTCMinutes(0, 0, 0);
    target.setUTCHours(22);
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
    // Clôture le vendredi à 22:00 UTC (1320 min)
    const estVendrediApresFermeture = (jour === 5 && tempsMinutes >= 22 * 60);
    const estSamedi = (jour === 6);
    const estDimancheAvantOuverture = (jour === 0 && tempsMinutes < 22 * 60);
    const estWeekend = estVendrediApresFermeture || estSamedi || estDimancheAvantOuverture;

    if (estWeekend) {
      const reouverture = getProchainDimanche22h(ts);
      return {
        ouvert: false,
        statut: 'ferme',
        classe,
        continu: false,
        weekend: true,
        raison: `Marché ${info.libelle} fermé le week-end (fermeture vendredi 22:00 UTC, réouverture dimanche 22:00 UTC)`,
        prochaineOuverture: reouverture,
        prochaineFermeture: null
      };
    }

    // Pré-fermeture du vendredi soir (dernières heures : liquidité faible, spreads accrus)
    if (jour === 5 && tempsMinutes >= 21 * 60 && tempsMinutes < 22 * 60) {
      return {
        ouvert: true,
        statut: 'pre_fermeture',
        classe,
        continu: false,
        weekend: false,
        raison: `Marché ${info.libelle} en phase de pré-fermeture du week-end (clôture à 22:00 UTC) : risque de slippage et spreads élargis`,
        prochaineOuverture: null,
        prochaineFermeture: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 22, 0, 0))
      };
    }

    // Pause quotidienne des métaux (21:00 → 22:00 UTC du lundi au jeudi)
    if (classe === 'metaux' && jour >= 1 && jour <= 4 && tempsMinutes >= 21 * 60 && tempsMinutes < 22 * 60) {
      return {
        ouvert: false,
        statut: 'pause',
        classe,
        continu: false,
        weekend: false,
        raison: `Pause de maintenance quotidienne des métaux (21:00–22:00 UTC)`,
        prochaineOuverture: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 22, 0, 0)),
        prochaineFermeture: null
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
      prochaineFermeture: getProchainVendredi22h(ts)
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
        prochaineOuverture: getProchainDimanche22h(ts),
        prochaineFermeture: null
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
      prochaineFermeture: null
    };
  }

  // Classe inconnue : on reste prudent
  return {
    ouvert: true,
    statut: 'ouvert',
    classe: 'inconnu',
    continu: false,
    weekend: (jour === 0 || jour === 6),
    raison: 'Classe d\'instrument inconnue : session non vérifiée',
    prochaineOuverture: null,
    prochaineFermeture: null
  };
}

module.exports = { statutMarche };
