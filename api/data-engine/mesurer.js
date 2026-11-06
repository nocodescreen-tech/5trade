#!/usr/bin/env node
/**
 * Mesure une stratégie RÉELLE sur l'historique en base.
 *
 *   npm run mesurer -- --strategie man_mv58vzhi9hyrqd --symbol R_75 --tf 15m
 *   npm run mesurer -- --strategie generique --symbol BTCUSDT --tf 5m
 *
 * Différence avec « calibrer » : ici on n'explore aucun seuil. On prend la fiche
 * telle qu'elle est en base (ou le jeu générique R1-R4 comme référence) et on
 * mesure, coûts compris, entraînement puis validation.
 *
 * Le but est de répondre à une seule question : cette stratégie, telle qu'elle est
 * écrite, produit-elle un avantage après frais — et tient-il hors échantillon ?
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const DB = require('../core/db');
const Candles = require('./candles');
const Backtest = require('../engine/backtest');
const Performance = require('../engine/performance');
const Signals = require('../engine/signals');

function options() {
  const a = process.argv.slice(2);
  const lire = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
  const libres = a.filter(x => !x.startsWith('--'));
  const strategie = lire('strategie', libres[0] || 'generique');
  const symbol = lire('symbol', libres[1] || 'R_75');
  const tf = lire('tf', libres[2] || '15m');
  const fenetre = Number(lire('fenetre', '5000'));
  const coutR = Number(lire('cout-r', '0.05'));
  // Permet de comparer la fiche courante (durcie) à la version précédente (souple),
  // pour savoir si le durcissement apporte ou retire quelque chose.
  const variante = lire('variante', 'fiche');
  // Combinaison ad hoc : sert à éprouver une hypothèse (R1+R5, R6 seul…) sans
  // modifier la fiche enregistrée ni la base.
  const regles = (lire('regles', '') || '').split(',').map(x => x.trim()).filter(Boolean);
  const seuilForce = Number(lire('force', '0.65'));
  const seuilRegles = Number(lire('seuil', '0'));
  return {
    strategie, symbol, tf, variante, regles, seuilForce, seuilRegles,
    fenetre: Number.isFinite(fenetre) ? fenetre : 5000,
    coutR: Number.isFinite(coutR) && coutR >= 0 ? coutR : 0.05
  };
}

const GENERIQUE = {
  id: 'generique', titre: 'Jeu générique (référence)',
  regles: ['R1', 'R2', 'R3', 'R4'],
  seuilForce: 0.65, seuilRegles: 2, parametres: { atrStop: 1 }
};

async function profilDemande(strategie) {
  if (strategie === 'generique') return { profil: GENERIQUE, source: 'référence générique R1-R4' };
  const docs = await DB.listStrategies();
  const doc = (docs || []).find(d => d.id === strategie);
  if (!doc) throw new Error(`stratégie « ${strategie} » absente de la base`);
  // On mesure la FICHE (compléments inclus), pas le seul champ « moteur » du
  // document : c'est la fiche qui porte les conditions obligatoires réellement
  // appliquées, et c'est elle qui est versionnée.
  const Registry = require('../strategy-engine/registry');
  const brute = Registry.ficheDepuisDocument(doc);
  const controle = require('../strategy-engine/strategy-contract').valider(brute);
  if (!controle.ok) {
    throw new Error(`fiche invalide : ${controle.erreurs.join(' ; ')}`);
  }
  const fiche = controle.fiche;
  const p = {
    id: fiche.id,
    titre: fiche.name,
    version: fiche.version,
    regles: fiche.requiredConditions,
    obligatoires: fiche.requiredConditions,
    seuilForce: fiche.parameters.seuilForce,
    seuilRegles: fiche.parameters.seuilRegles,
    timeframes: fiche.timeframes.execution,
    parametres: { atrStop: 1 }
  };
  return {
    profil: p,
    source: `fiche ${fiche.id} v${fiche.version} · règles ${p.regles.join(', ')} (toutes obligatoires)` +
      ` · seuil ${p.seuilForce} / ${p.seuilRegles}`
  };
}

async function principal() {
  const { strategie, symbol, tf, fenetre, coutR, variante, regles, seuilForce, seuilRegles } = options();
  await DB.init();
  if (!DB.isPg()) { console.log('PostgreSQL requis (npm run migrer).'); return; }

  let { profil, source } = await profilDemande(strategie);
  if (regles.length) {
    profil = { ...profil, regles, obligatoires: regles,
      seuilForce: Number.isFinite(seuilForce) ? seuilForce : 0.65,
      seuilRegles: seuilRegles > 0 ? seuilRegles : regles.length };
    source = 'combinaison ad hoc : ' + regles.join(' + ') + ' (toutes obligatoires)'
      + ' · force ' + profil.seuilForce + ' · seuil ' + profil.seuilRegles;
  } else if (variante === 'souple') {
    // Équivalent de la fiche 1.1.0 : balayage + zone, seuil 2/2.
    profil = { ...profil, regles: ['R1', 'R3'], obligatoires: ['R1', 'R3'],
      seuilForce: 0.5, seuilRegles: 2 };
    source += ' — VARIANTE SOUPLE (R1+R3, seuil 2/2)';
  }
  let serie = await Candles.lire(symbol, tf, { limite: 50000 });
  if (!serie.length) {
    console.log(`Aucune bougie pour ${symbol} ${tf}. Lancez « npm run ingerer -- ${symbol} ${tf} 10000 ».`);
    return;
  }
  if (serie.length > fenetre) serie = serie.slice(-fenetre);

  const coupe = Math.floor(serie.length * 0.7);
  console.log(`  ${symbol} ${tf} · ${serie.length} bougies (${coupe} / ${serie.length - coupe})`);
  console.log(`  ${source}`);
  console.log(`  coût appliqué : ${coutR} R par trade\n`);

  const mesurer = bougies => {
    const r = Backtest.lancer(bougies, { symbol, timeframe: tf },
      {
        profils: [profil], pas: 3, maxBougies: 20000, plafond: 20000, limiteTrades: 20000,
        // LA correction : ne garder que les signaux de STRATÉGIE. Sans ce filtre,
        // 2 000 trades de motifs se glissaient dans la mesure d'une stratégie.
        sources: ['strategie']
      });
    if (r.indisponible) return { indisponible: true, raison: r.raison };
    const clos = Performance.appliquerCout(
      (r.trades || []).filter(t => Number.isFinite(Number(t.r))), coutR);
    const m = Performance.metriques(clos);
    const brut = Performance.metriques((r.trades || []).filter(t => Number.isFinite(Number(t.r))));
    return { ...m, coutsInclus: true, brut };
  };

  const is = mesurer(serie.slice(0, coupe));
  const oos = mesurer(serie.slice(coupe));
  if (is.indisponible || oos.indisponible) {
    console.log(`  mesure impossible : ${(is.raison || oos.raison)}`);
    return;
  }

  const ligne = (nom, m) => console.log(
    `  ${nom.padEnd(13)} ${String(m.n).padStart(5)} trades · PF ${String(m.profitFactor).padEnd(6)} · ` +
    `espérance ${(m.expectancyR >= 0 ? '+' : '') + m.expectancyR} R · taux ${m.winRate ?? '—'} % · ` +
    `DD ${m.maxDrawdownR} R · total ${(m.rTotal >= 0 ? '+' : '') + m.rTotal} R`);

  ligne('entraînement', is);
  ligne('validation', oos);
  if (is.brut) {
    console.log(`  (brut, sans coût : entraînement ${is.brut.expectancyR >= 0 ? '+' : ''}${is.brut.expectancyR} R · ` +
      `validation ${oos.brut.expectancyR >= 0 ? '+' : ''}${oos.brut.expectancyR} R)`);
  }

  const verdict = Performance.verdictDepuisMetriques(is, oos);
  console.log(`\n  verdict : ${verdict.fiable ? 'avantage qui tient hors échantillon' : 'NON retenu'}` +
    (verdict.raisons.length ? ` — ${verdict.raisons.join(' ; ')}` : ''));
  console.log('  Rappel : mesuré sur un seul instrument et une seule découpe.');
}

module.exports = { principal };

if (require.main === module) {
  principal().then(() => process.exit(0)).catch(e => {
    console.error('ÉCHEC :', e.message);
    process.exit(1);
  });
}
