/**
 * Profils par classe de marché — parce que la même règle ne vaut pas partout.
 *
 * Constat mesuré sur les 800 trades tranchés du journal, avec les MÊMES règles
 * génériques appliquées à tous les marchés :
 *
 *   classe        n     PF     espérance   taux    drawdown
 *   synthétique   330   1.41   +0.188 R    42.1 %  16.44 R
 *   crypto        249   1.37   +0.143 R    46.3 %  24.80 R
 *   métaux        214   1.04   +0.017 R    39.2 %  11.67 R   ← aucune marge
 *   forex           7   0       -0.143 R     0 %    1.00 R   ← échantillon nul
 *
 * Et à l'intérieur même des indices synthétiques : R_10 PF 2.24 (+0.389 R),
 * R_25 1.35, R_75 1.23 (+0.12 R), R_100 2.59. Un seul jeu de seuils pour tout ça
 * revient à dire qu'un R_10 et un XAUUSD se lisent de la même façon. C'est faux.
 *
 * Ce fichier ne prétend pas être calibré : c'est une v1 explicite, regroupée ici
 * pour être versionnée et remplacée par une calibration hors échantillon (phase 3).
 * Chaque classe porte sa justification et son état.
 */

const PROFILS = {
  synthetique: {
    // Prix fabriqués par le courtier : pas de volume réel, pas de session, pas
    // d'actualité. La volatilité est un paramètre du produit, pas une propriété
    // du marché — d'où un seuil de « tendance » plus exigeant et un régime
    // volatil plus facile à déclencher.
    sessions: false,
    actualites: false,
    volume: false,
    seuilsRegime: { efficaciteTendance: 0.50, penteTendance: 0.26, atrVolatil: 1.35 },
    seuilForce: 0.60,
    atrStop: 1.2,
    etat: 'v1 — mesuré : PF 1.41 sur 330 trades, dispersion forte entre R_10 (2.24) et R_75 (1.23)',
    justification: 'volatilité fixée par le produit ; moyenne mobile du marché absente'
  },
  crypto: {
    // 24/7, volatilité élevée et changeante, liquidations en cascade.
    sessions: false,
    actualites: false,
    volume: true,
    seuilsRegime: { efficaciteTendance: 0.45, penteTendance: 0.24, atrVolatil: 1.80 },
    seuilForce: 0.62,
    atrStop: 1.5,
    etat: 'v1 — mesuré : PF 1.37 sur 249 trades, drawdown le plus élevé (24.80 R)',
    justification: 'amplitude supérieure : un stop calibré forex est trop court'
  },
  forex: {
    sessions: true,
    actualites: true,
    volume: true,
    seuilsRegime: { efficaciteTendance: 0.40, penteTendance: 0.20, atrVolatil: 1.50 },
    seuilForce: 0.65,
    atrStop: 1.0,
    etat: 'v1 — non mesuré : 7 trades seulement, aucun chiffre exploitable',
    justification: 'sessions et annonces structurent la journée ; échantillon actuel nul'
  },
  indices: {
    sessions: true,
    actualites: true,
    volume: true,
    seuilsRegime: { efficaciteTendance: 0.44, penteTendance: 0.22, atrVolatil: 1.60 },
    seuilForce: 0.65,
    atrStop: 1.1,
    etat: 'v1 — non mesuré (aucune série d\'indices réels dans le journal)',
    justification: 'ouverture et clôture créent des gaps : le régime change aux bornes de séance'
  },
  metaux: {
    sessions: true,
    actualites: true,
    volume: true,
    seuilsRegime: { efficaciteTendance: 0.42, penteTendance: 0.22, atrVolatil: 1.60 },
    seuilForce: 0.68,
    atrStop: 1.3,
    etat: 'v1 — mesuré : PF 1.04 sur 214 trades, espérance +0.017 R : marge nulle après frais',
    justification: 'le seuil de force est relevé : en dessous, les frais mangent le résultat'
  },
  energies: {
    sessions: true,
    actualites: true,
    volume: true,
    seuilsRegime: { efficaciteTendance: 0.45, penteTendance: 0.24, atrVolatil: 1.85 },
    seuilForce: 0.68,
    atrStop: 1.6,
    etat: 'v1 — non mesuré',
    justification: 'mouvements d\'offre : les cassures tiennent moins souvent qu\'en forex'
  },
  inconnu: {
    sessions: true,
    actualites: true,
    volume: true,
    seuilsRegime: {},
    seuilForce: 0.65,
    atrStop: 1.2,
    etat: 'aucun profil : instrument non identifié',
    justification: 'par défaut, le plus prudent — et le moteur refuse déjà d\'analyser un inconnu'
  }
};

const DEFAUT_REGIME = { efficaciteTendance: 0.42, penteTendance: 0.22, atrVolatil: 1.60 };

/** Profil d'une classe, avec repli prudent sur « inconnu ». */
function profilClasse(classe) {
  return PROFILS[classe] || PROFILS.inconnu;
}

/** Seuils de régime effectifs pour une classe (valeurs par défaut complétées). */
function seuilsRegime(classe) {
  return { ...DEFAUT_REGIME, ...(profilClasse(classe).seuilsRegime || {}) };
}

/** Vrai si l'instrument est soumis aux séances de cotation. */
const aSessions = classe => profilClasse(classe).sessions !== false;

/** Vrai si le filtre économique a un sens pour cet instrument. */
const aActualites = classe => profilClasse(classe).actualites !== false;

/** Vrai si la classe fournit un volume exploitable. */
const aVolume = classe => profilClasse(classe).volume !== false;

module.exports = { PROFILS, DEFAUT_REGIME, profilClasse, seuilsRegime, aSessions, aActualites, aVolume };
