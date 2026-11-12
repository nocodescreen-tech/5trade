'use strict';

// Étage DATA QUALITY : une série trouée ou figée ne produit pas un signal, elle
// produit une illusion de signal. C'est le MÊME module que la surveillance.
const Qualite = require('../data-engine/quality');
const Moteurs = require('../moteurs');
// SIGNAL NORMALIZER : une ligne de scan est rendue aussi dans la forme commune.
const Contrat = require('../engine/contrat');

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
// Plafond de stratégies par scan : au-delà, mieux vaut découper la demande que
// faire durer un cycle pendant lequel les données changent sous les pieds.
const MAX_STRATEGIES = 8;

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
/**
 * Unités à parcourir pour un symbole : l'unité de travail du scan, PLUS celles
 * sous lesquelles le marché est surveillé. Fonction pure → testable seule.
 */
function unitesPour(symbole, tf, tfsPour, TF_MS) {
  const brut = typeof tfsPour === 'function' ? (tfsPour(symbole) || []) : [];
  const sup = (Array.isArray(brut) ? brut : [brut]).filter(u => u && (!TF_MS || TF_MS[u]));
  return [...new Set([tf, ...sup])];
}

async function scanComplet({ market, signals, tf = '15m', intervalleMin = INTERVALLE_MIN, strategies = null, tfsPour = null } = {}) {
  if (!market || !signals) throw new Error('scan complet : market et signals sont requis');
  const debut = Date.now();
  const symboles = market.listSymbols() || [];
  const signaux = [];
  const erreurs = [];

  // PROFILS À ÉVALUER : zéro (repérage générique), une, ou plusieurs stratégies.
  // Les bougies sont chargées UNE fois par (marché, unité) puis chaque stratégie
  // tourne dessus : multiplier les stratégies ne multiplie pas le réseau.
  // `strategies` peut être une fonction : la configuration de surveillance change
  // en cours de route, et un scan périodique doit relire les stratégies à jour.
  const liste = (typeof strategies === 'function') ? ((await strategies()) || []) : strategies;
  const demandees = (Array.isArray(liste) && liste.length) ? liste : [];
  if (demandees.length > MAX_STRATEGIES) {
    erreurs.push(`${demandees.length} stratégies demandées : ${MAX_STRATEGIES} évaluées au maximum`);
  }
  const profils = demandees.slice(0, MAX_STRATEGIES);
  const optionsDe = p => (p ? {
    regles: p.regles,
    obligatoires: p.obligatoires || [],
    seuilForce: p.seuilForce,
    seuilRegles: p.seuilRegles,
    parametres: p.parametres,
    strategie: { id: p.id, titre: p.titre }
  } : {});
  const passes = profils.length
    ? profils.map(p => ({ profil: p, options: optionsDe(p) }))
    : [{ profil: null, options: {} }];

  // Unités de temps d'un symbole : l'unité de travail du scan, PLUS celles sous
  // lesquelles il est surveillé. Sans cela, les deux parcours pouvaient juger le
  // même marché sur deux unités différentes et se contredire sans que personne
  // ne le voie. Le coût reste borné : une ou deux unités par marché.
  const unitesDe = symbole => unitesPour(symbole, tf, tfsPour, market.TF_MS);
  const unitesVues = new Set([tf]);

  for (const s of symboles) {
    const symbole = s.symbol || s.provider || s;
    const provider = s.provider || undefined;
    for (const unite of unitesDe(symbole)) {
      unitesVues.add(unite);
      try {
        const r = await market.getCandles(symbole, unite, BOUGIES, provider);
        const closes = (r.candles || []).filter(c => c.closed !== false);
        const q = Qualite.analyser(r.candles || [], { timeframe: unite });
        if (!q.ok) {
          erreurs.push(`${symbole} ${unite} : données non fiables — `
            + q.problemes.filter(p => p.gravite === 'critique').map(p => p.detail).join(', '));
          continue;
        }
        if (closes.length < MIN_BOUGIES) {
          erreurs.push(`${symbole} ${unite} : ${closes.length} bougie(s)`);
          continue;
        }
        // ── MOTEUR DE LA CLASSE ─────────────────────────────────────────
        // Le scan appliquait la même grille à tous les instruments. Ici, la
        // classe de l'instrument choisit son moteur. Quand la classe a un
        // moteur dédié, il peut REFUSER la lecture (produit à sauts, série
        // autocorrélée…) : dans ce cas aucun signal n'est publié, et la raison
        // est écrite. Quand elle n'en a pas, la ligne le dit au lieu de laisser
        // croire à une analyse spécialisée.
        const { classifier } = require('../market-intelligence/instrument-classifier');
        const classe = classifier(symbole, { provider }).classe;
        const moteur = Moteurs.pour(classe);
        let diagnostic = null;
        if (moteur.analyser) {
          diagnostic = Moteurs.analyser(classe, closes.map(c => c.c), { symbol: symbole, classe, timeframe: unite });
          if (diagnostic && diagnostic.convient === false) {
            erreurs.push(`${symbole} ${unite} : lecture refusée par le moteur ${moteur.id} — `
              + (diagnostic.refus || []).join(' · '));
            continue;
          }
        }

        // Pour CHAQUE profil : ses règles, ses conditions obligatoires et ses
        // seuils — sinon le scan annoncerait des signaux que la stratégie refuse.
        // Les bougies, elles, ont été chargées une seule fois.
        for (const passe of passes) {
          const v = signals.detect(closes, { symbol: symbole, timeframe: unite }, passe.options);
          if (!v) continue;
          // On ne garde que ce qui dit quelque chose : un univers entier de
          // « NEUTRE » n'aide personne à décider.
          if (!v.direction || v.direction === 'NEUTRE') continue;
          // Forme COMMUNE attachée à chaque ligne : le scan parle « symbole/tf/
          // direction », le reste de l'app parle « sens/entree/stop ». Un
          // consommateur ne doit pas avoir à connaître les deux.
          const ligne = {
            symbole,
            provider: provider || null,
            tf: unite,
            direction: v.direction,
            status: v.status || null,
            force: typeof v.force === 'number' ? v.force : (v.strength || 0),
            trend: v.trend || null,
            confirmations: v.confirmations || 0,
            // Quelle stratégie a produit cette ligne : null = moteur générique.
            strategie: passe.profil ? (passe.profil.titre || passe.profil.id) : null,
            raison: v.raison || null,
            // Qualité de la série qui a produit ce signal : 100 = rien à signaler.
            qualite: q.score,
            // D'où vient la lecture : classe, moteur, et s'il est réellement dédié.
            classe,
            moteur: moteur.id,
            moteurSpecialise: !!moteur.specialise,
            moteurVersion: moteur.version || null,
            // Le diagnostic du moteur quand il en produit un (synthétiques).
            diagnostic: diagnostic ? {
              famille: diagnostic.famille, regime: diagnostic.regime,
              faits: diagnostic.faits, statistiques: diagnostic.statistiques
            } : null
          };
          ligne.contrat = Contrat.normaliser(ligne, { source: 'scan' });
          signaux.push(ligne);
        }
      } catch (e) {
        erreurs.push(`${symbole} ${unite} : ${e.message}`);
      }
    }
  }

  signaux.sort((a, b) => (b.force || 0) - (a.force || 0));
  etat.dernier = {
    at: new Date().toISOString(),
    tf,
    // Unités réellement parcourues : l'écran peut dire sur quoi le scan a porté.
    tfs: [...unitesVues],
    // Stratégies réellement évaluées (vide = moteur générique, simple repérage).
    strategies: profils.map(p => p.titre || p.id),
    marches: symboles.length,
    signaux: signaux.length,
    // Les erreurs voyagent AVEC le résultat : un scan qui échoue sur 20 marchés
    // rendait une liste vide sans un mot d'explication.
    erreurs: erreurs.slice(0, 20),
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
  etat.chevauchements = 0;

  // VERROU D'EXÉCUTION. Avant, `setInterval` relançait `scanComplet` sans se
  // soucier du précédent : un cycle long (téléchargements lents, fournisseur
  // muet) en voyait un second démarrer par-dessus, les deux écrivant le même
  // `etat.dernier` et martelant les mêmes instruments. Un seul cycle à la fois.
  const lancer = () => {
    if (etat.enCours) {
      etat.chevauchements++;
      return;
    }
    etat.enCours = true;
    scanComplet(deps)
      .catch(e => { etat.erreurs = [e.message]; })
      .finally(() => { etat.enCours = false; });
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
    erreurs: etat.erreurs,
    // Visible : un cycle en cours et le nombre de déclenchements évités.
    enCours: !!etat.enCours,
    chevauchementsEvites: etat.chevauchements || 0
  };
}

module.exports = { scanComplet, start, stop, dernierScan, unitesPour, INTERVALLE_MIN };
