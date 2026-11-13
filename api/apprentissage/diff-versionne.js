/**
 * 5trade — Apprentissage : diff versionné.
 *
 * Publie chaque matin un journal `journal-YYYY-MM-DD.md` qui résume :
 *   - ce que le système a appris hier
 *   - les ajustements proposés/promus
 *   - les croyances créées/rétrogradées
 *   - les variantes en shadow run
 *   - les métriques 14j glissantes
 *
 * Le journal est lisible par l'humain ET parsable par le chat CRUD
 * ("qu'est-ce que tu as appris cette semaine ?").
 */

const fs = require('fs').promises;
const path = require('path');

const JOURNAL_DIR = () => path.join(process.env.DATA_DIR || './data', 'apprentissage');

/**
 * Publie le journal quotidien.
 * @param {object} p
 * @param {Array} p.trades_veille       trades exécutés hier
 * @param {Array} p.candidats           candidats d'ajustement (post-mortems)
 * @param {Array} p.promotions          ajustements promus aujourd'hui
 * @param {Array} p.shadow_runs         variantes en shadow run
 * @param {object} p.metrics_14j        { expectancy, winRate, trades }
 * @param {Array} p.croyances_crees     nouvelles croyances
 * @param {Array} p.croyances_retrogradees
 * @param {Array} p.exceptions_creess
 */
async function publierJournal({
  trades_veille = [],
  candidats = [],
  promotions = [],
  shadow_runs = [],
  metrics_14j = {},
  croyances_crees = [],
  croyances_retrogradees = [],
  exceptions_crees = [],
}) {
  const auj = new Date().toISOString().slice(0, 10);
  const fichier = path.join(JOURNAL_DIR(), `journal-${auj}.md`);
  await fs.mkdir(path.dirname(fichier), { recursive: true });

  const expectancyVeille = trades_veille.length
    ? trades_veille.reduce((a, t) => a + (Number(t.r_realise) || 0), 0) / trades_veille.length
    : null;
  const gagnantsVeille = trades_veille.filter(t => (Number(t.r_realise) || 0) > 0).length;

  const lignes = [
    `# Journal d'apprentissage — ${auj}`,
    '',
    '## Hier j\'ai appris',
    '',
    '### Ce qui a marché',
    commercePositif(trades_veille),
    '',
    '### Ce qui a échoué',
    commerceNegatif(trades_veille),
    '',
    '### Ajustements proposés (en shadow run 3 jours)',
    ...(candidats.length === 0
      ? ['- Aucun candidat aujourd\'hui.']
      : candidats.map(c =>
        `- \`${c.parametre}\` : ${c.ancien} → ${c.nouveau} (${c.raison}) — impact estimé : ${c.impact_estime}`)),
    '',
    '### Ajustements promus aujourd\'hui',
    ...(promotions.length === 0
      ? ['- Aucune promotion.']
      : promotions.map(p =>
        `- \`${p.parametre}\` : ${p.ancien} → ${p.nouveau} (version ${p.version})`)),
    '',
    '### Variantes en shadow run',
    ...(shadow_runs.length === 0
      ? ['- Aucune variante en cours.']
      : shadow_runs.map(s =>
        `- Variante ${s.id} : ${s.description} — expectancy ${s.expectancy} sur ${s.trades} trades`)),
    '',
    '## Métriques glissantes 14j',
    '',
    `- Expectancy : ${metrics_14j.expectancy || 'N/A'} (objectif > 0.20)`,
    `- Win rate : ${((metrics_14j.winRate || 0) * 100).toFixed(1)}% (objectif > 35%)`,
    `- Trades/jour : ${((metrics_14j.trades || 0) / 14).toFixed(1)} (cible 1-5)`,
    '',
    '## Croyances',
    '',
    '### Nouvelles',
    ...(croyances_crees.length === 0
      ? ['- Aucune nouvelle croyance.']
      : croyances_crees.map(c => `- ${c.description} (confiance ${c.confiance}, ${c.trades} trades)`)),
    '',
    '### Rétrogradées',
    ...(croyances_retrogradees.length === 0
      ? ['- Aucune rétrogradation.']
      : croyances_retrogradees.map(c => `- ${c.description} (confiance ${c.confiance})`)),
    '',
    '## Exceptions créées',
    ...(exceptions_crees.length === 0
      ? ['- Aucune nouvelle exception.']
      : exceptions_crees.map(e => `- ${e.titre} (source : ${e.source})`)),
    '',
    '---',
    '',
  ];

  const contenu = lignes.join('\n');
  await fs.writeFile(fichier, contenu);
  return { fichier, contenu };
}

function commercePositif(trades) {
  const pos = trades.filter(t => (Number(t.r_realise) || 0) > 0);
  if (!pos.length) return ['- Aucun trade gagnant hier.'];
  return pos.map(t =>
    `- ${t.instrument} ${t.direction} à ${new Date(t.entree_at).toISOString()} → +${t.r_realise}R (${t.issue})`);
}

function commerceNegatif(trades) {
  const neg = trades.filter(t => (Number(t.r_realise) || 0) <= 0);
  if (!neg.length) return ['- Aucun trade perdant hier.'];
  return neg.map(t =>
    `- ${t.instrument} ${t.direction} à ${new Date(t.entree_at).toISOString()} → ${t.r_realise}R (${t.issue})`);
}

/**
 * Liste les N derniers journaux.
 */
async function listerJournaux(limit = 7) {
  const dir = JOURNAL_DIR();
  try {
    const fichiers = await fs.readdir(dir);
    return fichiers
      .filter(f => f.startsWith('journal-') && f.endsWith('.md'))
      .sort().reverse().slice(0, limit);
  } catch { return []; }
}

/**
 * Lit un journal par date (YYYY-MM-DD).
 */
async function lireJournal(date) {
  const fichier = path.join(JOURNAL_DIR(), `journal-${date}.md`);
  try { return await fs.readFile(fichier, 'utf8'); }
  catch { return null; }
}

module.exports = { publierJournal, listerJournaux, lireJournal };
