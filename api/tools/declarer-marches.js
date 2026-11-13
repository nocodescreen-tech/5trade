/**
 * Déclare le marché de chaque fiche stratégie, sans l'inventer.
 *
 * Deux cas seulement :
 *  - la fiche NOMME son marché dans son texte ou ses tags → on le reprend ;
 *  - elle n'en dit rien → on déclare « non restreint » (`['*']`), ce qui est une
 *    déclaration explicite, pas une supposition, et qui reste modifiable.
 *
 * Chaque fiche reçoit `marchesSource` pour que l'interface puisse distinguer un
 * marché réellement écrit dans la fiche d'un « non restreint » par défaut.
 *
 * Usage : node tools/declarer-marches.js [--ecrire]
 */
const fs = require('fs');
const path = require('path');

const dossier = path.join(__dirname, '..', '..', 'knowledge-base');
const ecrire = process.argv.includes('--ecrire');

const REGLES = [
  { marche: 'forex', motifs: /forex|devise|eurusd|gbpusd|usdjpy|paire de devises/i },
  { marche: 'synthetique', motifs: /synth[ée]tique|volatility|boom|crash|deriv|\br_\d+\b/i },
  { marche: 'crypto', motifs: /crypto|bitcoin|\bbtc\b|\beth\b|binance/i },
  { marche: 'indices', motifs: /indice|index|us30|nas100|spx500|dax/i },
  { marche: 'metaux', motifs: /or\b|gold|xau|argent|xag|m[ée]tal/i },
  { marche: 'energies', motifs: /p[ée]trole|wti|brent|[ée]nergie/i }
];

const resume = [];
for (const f of fs.readdirSync(dossier).filter(x => x.endsWith('.json'))) {
  const complet = path.join(dossier, f);
  const doc = JSON.parse(fs.readFileSync(complet, 'utf8'));
  if (doc.type !== 'strategy') continue;
  if (Array.isArray(doc.marches) && doc.marches.length) {
    resume.push([doc.id, doc.marches.join(','), 'déjà déclaré']);
    continue;
  }

  const texte = `${doc.title || ''} ${doc.content || ''} ${(doc.tags || []).join(' ')}`;
  const trouvees = REGLES.filter(r => r.motifs.test(texte)).map(r => r.marche);

  // Un seul marché nommé → on le retient. Plusieurs → on les retient tous.
  // Aucun → « non restreint », déclaré comme tel.
  doc.marches = trouvees.length ? [...new Set(trouvees)] : ['*'];
  doc.marchesSource = trouvees.length ? 'texte de la fiche' : 'non restreint (la fiche ne nomme aucun marché)';
  doc.marchesDeclareLe = new Date().toISOString().slice(0, 10);

  resume.push([doc.id, doc.marches.join(','), doc.marchesSource]);
  if (ecrire) fs.writeFileSync(complet, JSON.stringify(doc, null, 2) + '\n', 'utf8');
}

for (const [id, marches, src] of resume) {
  console.log(`${String(id).padEnd(24)} ${marches.padEnd(28)} ${src}`);
}
console.log(`\n${resume.length} fiche(s) — ${ecrire ? 'écrites' : 'simulation (ajouter --ecrire)'}`);
