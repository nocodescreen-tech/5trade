/**
 * Fiches de stratégie — compléments explicitement écrits (revus par un humain).
 *
 * Le registre ne devine RIEN : quand un document ne déclare pas ses marchés, sa
 * fiche reste vide et le diagnostic dit ce qui manque. Ce fichier est l'endroit où
 * l'on comble ces manques, avec la justification de chaque valeur — pour qu'une
 * compatibilité ne soit jamais le fruit d'une déduction automatique.
 *
 * Règle : chaque valeur ajoutée ici doit citer sa source (titre de la stratégie,
 * champ de son moteur, décision explicite).
 */

const FICHES = {
  // Scalping sweep + FVG/OB sur indices synthétiques.
  // Seule stratégie disposant d'un moteur exécutable (2 règles, seuil 2/2).
  //
  // MESURE HORS ÉCHANTILLON du 2026-11-05 (historique en base, coût 0.05 R/trade,
  // découpe 70/30) — voir docs/MESURE-2026-11-05.md :
  //   R_75 15m : entraînement 2 012 trades, PF 0.91, -0.052 R (brut -0.002 R)
  //              validation  761 trades, PF 1.00,  0.000 R
  //   R_25 15m : entraînement 2 083 trades, PF 0.92, -0.047 R (brut +0.003 R)
  //              validation  833 trades, PF 1.10, +0.050 R
  //   Verdict : NON RETENU. L'avantage brut est de quelques millièmes de R, il ne
  //   survit pas aux frais ; et R1+R3 ne fait pas mieux que le jeu générique R1-R4.
  //   La fiche reste enregistrée « testée » dans le registre, PAS « validée ».
  man_mv58vzhi9hyrqd: {
    // 1.1.0 : la fiche précédente (1.0.0) ne déclarait aucun marché. Une fiche
    // publiée étant immuable, on publie une nouvelle version.
    version: '1.1.0',
    supportedMarkets: ['synthetique'],
    // R1 et R3 sont les seules règles du moteur, avec seuilRegles = 2 :
    // les deux sont donc obligatoires, l'une ne suffit pas.
    requiredConditions: ['R1', 'R3'],
    optionalConditions: [],
    justifications: {
      supportedMarkets: 'titre de la stratégie : « sur indices synthétiques »',
      requiredConditions: 'moteur : regles [R1, R3] et seuilRegles 2 sur 2 règles',
      supportedRegimes: 'non déclaré par la stratégie : laissé vide, donc évaluée sur tous les régimes'
    }
  }
};

/** Complément de fiche, ou null. */
const complement = id => FICHES[id] || null;

/**
 * Diagnostic d'exécutabilité d'un document de stratégie.
 * @returns {{executable:boolean, manques:string[], complement:boolean}}
 */
function diagnostic(doc) {
  const manques = [];
  const m = (doc && doc.moteur) || null;
  if (!m) {
    return { executable: false, complement: false,
      manques: ['aucun moteur : description textuelle, pas un algorithme'] };
  }
  const c = complement(doc.id) || {};
  const marches = Array.isArray(m.marches) ? m.marches : (c.supportedMarkets || []);
  const regles = Array.isArray(m.regles) ? m.regles : (c.requiredConditions || []);
  const tf = Array.isArray(m.timeframes) ? m.timeframes : [];
  if (!marches.length) manques.push('marchés non déclarés (supportedMarkets)');
  if (!regles.length) manques.push('aucune condition obligatoire (requiredConditions)');
  if (!tf.length) manques.push('aucune unité de temps d\'exécution');
  if (!m.seuilForce && m.seuilForce !== 0) manques.push('seuil de force non déclaré');
  return { executable: manques.length === 0, complement: Boolean(complement(doc.id)), manques };
}

module.exports = { FICHES, complement, diagnostic };
