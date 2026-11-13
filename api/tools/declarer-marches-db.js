/**
 * Déclare le marché des fiches EN BASE (les 31 réellement utilisées par l'app).
 *
 * La première version ne traitait que les fichiers de `knowledge-base/` (12) :
 * l'application, elle, charge 31 fiches depuis PostgreSQL. La sélection restait
 * donc à « 0 compatible, 31 non déclarées ».
 *
 * Même règle de provenance : le marché est repris du texte s'il y est nommé,
 * sinon la fiche est déclarée « non restreinte » (`['*']`), ce qui est explicite
 * et réversible.
 *
 * Usage : node tools/declarer-marches-db.js [--ecrire]
 */
// tools/ est un niveau plus bas que api/ : la racine du dépôt est en ../../
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const DB = require('../core/db');

const ecrire = process.argv.includes('--ecrire');

const REGLES = [
  { marche: 'forex', motifs: /forex|devise|eurusd|gbpusd|usdjpy|paire de devises/i },
  { marche: 'synthetique', motifs: /synth[ée]tique|volatility|boom|crash|deriv|\br_\d+\b|1hz/i },
  { marche: 'crypto', motifs: /crypto|bitcoin|\bbtc\b|\beth\b|binance/i },
  { marche: 'indices', motifs: /indice|index|us30|nas100|spx500|dax/i },
  { marche: 'metaux', motifs: /or\b|gold|xau|argent|xag|m[ée]tal/i },
  { marche: 'energies', motifs: /p[ée]trole|wti|brent|[ée]nergie/i }
];

function texteDe(d) {
  const s = d.structured || {};
  const morceaux = [d.title, d.content, (d.tags || []).join(' '),
    (d.concepts || []).join(' '), JSON.stringify(s).slice(0, 4000)];
  return morceaux.filter(Boolean).join(' ');
}

(async () => {
  await DB.init();
  const fiches = (await DB.listStrategies()) || [];
  const bilan = { deja: 0, ecrites: 0, nonRestreintes: 0, nommees: 0 };

  for (const f of fiches) {
    const actuel = Array.isArray(f.marches) && f.marches.length ? f.marches
      : (Array.isArray(f.supportedMarkets) && f.supportedMarkets.length ? f.supportedMarkets : null);
    if (actuel) {
      bilan.deja++;
      console.log(`${String(f.id).padEnd(26)} ${actuel.join(',').padEnd(22)} déjà déclaré`);
      continue;
    }

    const trouvees = [...new Set(REGLES.filter(r => r.motifs.test(texteDe(f))).map(r => r.marche))];
    const marches = trouvees.length ? trouvees : ['*'];
    const src = trouvees.length ? 'texte de la fiche' : 'non restreint (aucun marché nommé)';

    const maj = {
      ...f,
      marches,
      marchesSource: src,
      marchesDeclareLe: new Date().toISOString().slice(0, 10)
    };
    if (ecrire) await DB.saveStrategyRecord(maj);
    if (trouvees.length) bilan.nommees++; else bilan.nonRestreintes++;
    bilan.ecrites++;
    console.log(`${String(f.id).padEnd(26)} ${marches.join(',').padEnd(22)} ${src}`);
  }

  console.log(`\n${fiches.length} fiche(s) : ${bilan.deja} déjà déclarée(s), `
    + `${bilan.nommees} nommée(s) dans leur texte, ${bilan.nonRestreintes} non restreinte(s)`
    + ` — ${ecrire ? 'écrites en base' : 'simulation (ajouter --ecrire)'}`);
  process.exit(0);
})().catch(e => { console.log('ERREUR:', e.message.slice(0, 140)); process.exit(1); });
