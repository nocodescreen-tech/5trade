/**
 * PHASE 1 — le contrat de signal tient-il de bout en bout ?
 *
 * Question mesurée : pour un signal réel, les niveaux (entrée, stop, objectifs)
 * sont-ils identiques dans le moteur, dans le contrat normalisé et dans le
 * journal ? Toute divergence signifie que le graphique dessine une chose,
 * l'alerte en annonce une autre et le journal en mesure une troisième.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const M = require('../sources/market');
const DE = require('../engine/DecisionEngine');
const J = require('../engine/journal-signaux');
const Contrat = require('../engine/contrat');

const lireNiveaux = o => (o ? {
  entree: o.entree ?? o.entry ?? null,
  stop: o.stop ?? null,
  tp: o.objectifs ?? o.targets ?? null
} : null);

(async () => {
  const { candles } = await M.getCandles('R_75', '15m', 300);
  const v = DE.decider(candles, { symbol: 'R_75', timeframe: '15m' }, { exigerAlignement: false });

  // On compare sur le signal exécutable s'il existe ; sinon sur le premier
  // signal qui PORTE des niveaux — la traçabilité se vérifie aussi là.
  let choisi = v.signal;
  let executable = !!choisi;
  if (!choisi) {
    choisi = (v.signaux || []).find(x =>
      (x.levels && Number.isFinite(x.levels.entry)) || Number.isFinite(x.entree)) || null;
  }
  console.log('décision :', v.decision, '| signaux examinés :', (v.signaux || []).length);
  if (!choisi) { console.log('Aucun signal porteur de niveaux.'); process.exit(0); }
  console.log('signal retenu pour la comparaison :', choisi.nom, '· exécutable :', executable);

  const moteur = lireNiveaux({
    entree: choisi.levels && choisi.levels.entry !== undefined ? choisi.levels.entry : choisi.entree,
    stop: choisi.levels && choisi.levels.stop !== undefined ? choisi.levels.stop : choisi.stop,
    objectifs: (choisi.levels && (choisi.levels.objectifs || choisi.levels.targets)) || choisi.objectifs
  });
  console.log('1. MOTEUR  ', JSON.stringify(moteur));

  const c = Contrat.normaliser(choisi, { source: 'verdict', symbol: 'R_75', timeframe: '15m' });
  const contrat = lireNiveaux({ entree: c.entree, stop: c.stop, objectifs: c.objectifs });
  console.log('2. CONTRAT ', JSON.stringify(contrat));

  const avant = (J.charger().signaux || []).length;
  J.enregistrer([c], { symbol: 'R_75', timeframe: '15m', provider: 'deriv', at: Date.now() });
  const apres = J.charger().signaux || [];
  const ecrit = apres.length > avant ? apres[apres.length - 1] : null;
  const journal = ecrit ? lireNiveaux(ecrit) : null;
  console.log('3. JOURNAL ', JSON.stringify(journal));

  const ecarts = [];
  for (const cle of ['entree', 'stop']) {
    if (moteur[cle] !== contrat[cle]) ecarts.push(`${cle} : moteur ${moteur[cle]} → contrat ${contrat[cle]}`);
    if (journal && journal[cle] !== contrat[cle]) ecarts.push(`${cle} : contrat ${contrat[cle]} → journal ${journal[cle]}`);
  }
  if (JSON.stringify(moteur.tp || []) !== JSON.stringify(contrat.tp || [])) {
    ecarts.push(`objectifs : moteur ${JSON.stringify(moteur.tp)} → contrat ${JSON.stringify(contrat.tp)}`);
  }
  if (journal && JSON.stringify(journal.tp || []) !== JSON.stringify(contrat.tp || [])) {
    ecarts.push(`objectifs : contrat ${JSON.stringify(contrat.tp)} → journal ${JSON.stringify(journal.tp)}`);
  }

  console.log('\nécarts :', ecarts.length ? ecarts.join(' ; ') : 'aucun');
  process.exit(ecarts.length ? 1 : 0);
})().catch(e => { console.log('ERREUR:', e.message.slice(0, 160)); process.exit(1); });
