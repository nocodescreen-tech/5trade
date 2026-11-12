#!/usr/bin/env node
/**
 * BANC DE MESURE — divergence entre les deux moteurs de signaux.
 *
 *   A) `engine/signals.js`  → Signals.detect()   : UN verdict (règles R1–R8)
 *   B) `engine/signaux.js`  → detecterTout()     : un signal par stratégie/motif/structure,
 *                            arbitré par DecisionEngine
 *
 * Les deux répondent à la MÊME question et sont exposés séparément à l'écran.
 * Ce banc mesure à quelle fréquence ils se contredisent, sur données réelles.
 *
 * Usage :
 *   node api/tools/divergence-moteurs.js                 # 14 marchés × 2 unités
 *   node api/tools/divergence-moteurs.js --marches 30 --unites 5m,15m,1h
 *   node api/tools/divergence-moteurs.js --json /tmp/base.json   # pour comparer avant/après
 *
 * Sortie : tableau lisible + code 0 (c'est un diagnostic, pas un test).
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const Market = require('../sources/market');
const Signals = require('../engine/signals');
const DecisionEngine = require('../engine/DecisionEngine');

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
};

const NB_MARCHES = Number(arg('marches', 14));
const UNITES = String(arg('unites', '15m,1h')).split(',').map(t => t.trim()).filter(Boolean);
const SORTIE = arg('json', null);

const sensDe = d => (d === 'BUY' ? 'ACHAT' : d === 'SELL' ? 'VENTE' : 'NEUTRE');

// DecisionEngine s'exprime en français (ACHAT / VENTE / ATTENTE / NO_TRADE),
// Signals.detect en anglais (BUY / SELL). Un banc qui mélange les deux
// vocabulaires mesure sa propre erreur : c'est arrivé une fois ici.
const sensDecision = d => (d === 'ACHAT' ? 'ACHAT' : d === 'VENTE' ? 'VENTE' : 'NEUTRE');

(async () => {
  try { Market.loadCache(); } catch { /* cache facultatif */ }

  const marches = (Market.listSymbols() || []).slice(0, NB_MARCHES);
  const lignes = [];
  const bilan = { identiques: 0, partiels: 0, contradictions: 0, series: 0, confirmesSansExecution: 0 };

  for (const m of marches) {
    const symbole = m.symbol || m.provider || m;
    for (const tf of UNITES) {
      let bougies;
      try {
        const r = await Market.getCandles(symbole, tf, 300, m.provider);
        bougies = (r.candles || []).filter(c => c.closed !== false);
      } catch (e) {
        lignes.push({ symbole, tf, erreur: e.message });
        continue;
      }
      if (bougies.length < 60) {
        lignes.push({ symbole, tf, erreur: `${bougies.length} bougies` });
        continue;
      }

      // A — verdict unique.
      const a = Signals.detect(bougies, { symbol: symbole, timeframe: tf }, {});

      // Alignement multi-unités, calculé comme le fait /api/decision : sans lui,
      // le banc mesurerait une décision qui n'a pas reçu ce qu'elle exige.
      const unitesMtf = (Signals.TF_SUPERIEURS[tf] || [tf]).slice(0, 5);
      const parUnite = [];
      for (const u of unitesMtf) {
        try {
          const r2 = await Market.getCandles(symbole, u, 300, m.provider);
          const cl = (r2.candles || []).filter(x => x.closed !== false);
          if (cl.length >= 20) parUnite.push({ tf: u, verdict: Signals.detect(cl, { symbol: symbole, timeframe: u }, {}) });
        } catch { /* unité indisponible */ }
      }
      const confluence = parUnite.length ? Signals.confluence(parUnite, {}) : null;

      // B — multi-signaux arbitrés.
      const b = DecisionEngine.decider(bougies, { symbol: symbole, timeframe: tf }, {
        exigerAlignement: true, refuserDesaccord: true,
        refuserContreTendance: true, verifierFrais: true, verifierModele: true,
        confluence
      });

      const sensA = sensDe(a && a.direction);
      const sensB = sensDecision(b.decision);
      const contradiction = sensA !== 'NEUTRE' && sensB !== 'NEUTRE' && sensA !== sensB;
      const accord = sensA === sensB
        ? 'identiques'
        : (sensA === 'NEUTRE' || sensB === 'NEUTRE' ? 'partiels' : 'contradictions');
      bilan[accord]++;
      bilan.series++;
      // Le nombre qui compte vraiment : le verdict se dit CONFIRMÉ et la
      // décision ne trouve RIEN d'exécutable. Comparer un biais (« ACHAT
      // neutre ») à une décision gonfle la divergence ; celle-ci est réelle.
      const confirmeSansExecution = a && a.status === 'confirme' && (b.trace.execution.executables || 0) === 0;
      if (confirmeSansExecution) bilan.confirmesSansExecution++;

      lignes.push({
        symbole, tf, accord,
        a: { sens: sensA, statut: a && a.status, force: a && a.strength, score: a && a.force },
        confirmeSansExecution,
        mtf: confluence ? `${confluence.nbAlignes}/${(confluence.detail || []).length}` : 'non vérifié',
        b: { sens: sensB, decision: b.decision,
          confirmes: b.trace.confirmation.confirmes,
          executables: b.trace.execution.executables }
      });
    }
  }

  const larg = (l, n = 12) => String(l).padEnd(n);
  console.log('');
  console.log('marché        unité   A: verdict          B: décision          accord');
  console.log('─'.repeat(78));
  for (const l of lignes) {
    if (l.erreur) { console.log(`${larg(l.symbole)}${larg(l.tf)}—                      —                    ${l.erreur}`); continue; }
    const ca = `${l.a.sens} ${l.a.statut || ''}`.trim();
    const cb = `${l.b.sens} ${l.b.decision} (${l.b.executables} exéc.)`.trim();
    const marque = l.accord === 'identiques' ? '  =' : l.accord === 'partiels' ? '  ~' : '  ✗';
    console.log(`${larg(l.symbole)}${larg(l.tf)}${larg(ca, 24)}${larg(cb, 26)}${l.accord}${marque}`);
  }
  console.log('─'.repeat(78));
  console.log(`séries ${bilan.series} · identiques ${bilan.identiques} · partiels ${bilan.partiels} · CONTRADICTIONS ${bilan.contradictions}`);
  console.log(`verdict CONFIRMÉ mais aucune exécution côté décision : ${bilan.confirmesSansExecution}`);
  if (bilan.series) {
    console.log(`accord strict : ${Math.round((bilan.identiques / bilan.series) * 100)} %`);
  }

  if (SORTIE) {
    fs.writeFileSync(SORTIE, JSON.stringify({ at: new Date().toISOString(), bilan, lignes }, null, 1));
    console.log(`\nrelevé écrit dans ${SORTIE}`);
  }
})();
