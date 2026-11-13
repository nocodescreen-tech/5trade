/**
 * 5trade — Apprentissage : narrateur.
 *
 * Explique une décision passée en langage naturel, à partir des preuves
 * enregistrées au moment de la décision. Sert le chat CRUD quand l'utilisateur
 * demande "pourquoi tu as pris ce trade ?".
 *
 * Le narrateur ne raconte pas une belle histoire : il cite les faits, les
 * seuils utilisés, le niveau de compétence du système sur le contexte,
 * et l'éventuel slippage.
 */

const Memoire = require('../memoire');

/**
 * @param {object} trade      trade avec preuves, conditions_valides, conditions_manquantes
 * @returns {Promise<string>} explication lisible
 */
async function expliquerTrade(trade) {
  if (!trade) return 'Trade introuvable.';

  const parties = [];

  // 1. Résumé factuel
  parties.push(
    `Trade #${trade.id || '?'}, ${trade.instrument} ${trade.direction} ` +
    `à ${trade.entree_prix} (le ${new Date(trade.entree_at).toISOString()}), ` +
    `stop ${trade.stop_prix}, TP1 ${trade.tp1_prix}, TP2 ${trade.tp2_prix}.`
  );

  // 2. Issue si clôturé
  if (trade.issue) {
    parties.push(
      `Issue : ${trade.issue}, R réalisé ${trade.r_realise}, ` +
      `durée ${trade.duree_minutes || '?'} min, slippage ${trade.slippage_pips || 0} pips.`
    );
  }

  // 3. Raisonnement (les preuves enregistrées)
  if (Array.isArray(trade.preuves) && trade.preuves.length) {
    parties.push('Raisonnement :');
    trade.preuves.forEach((p, i) => parties.push(`  ${i + 1}. ${p}`));
  }

  // 4. Conditions validées/manquantes
  if (Array.isArray(trade.conditions_valides) && trade.conditions_valides.length) {
    parties.push(`Conditions validées (${trade.conditions_valides.length}) : ${trade.conditions_valides.join(', ')}.`);
  }
  if (Array.isArray(trade.conditions_manquantes) && trade.conditions_manquantes.length) {
    parties.push(`Conditions manquantes (${trade.conditions_manquantes.length}) : ${trade.conditions_manquantes.join(', ')}.`);
  }

  // 5. Niveau de compétence du système sur ce contexte
  if (trade.regime_entree && trade.killzone_entree) {
    const ctx = {
      regime: trade.regime_entree,
      killzone: trade.killzone_entree,
      setup: trade.setup || 'standard',
      instrument: trade.instrument
    };
    const comp = await Memoire.croyances.niveauCompetence(ctx);
    const tradeLabel = comp.trades ? `${comp.trades} trades` : '0 trade';
    const expLabel = comp.expectancy !== undefined ? `, expectancy ${comp.expectancy}` : '';
    parties.push(
      `Mon niveau sur ce contexte (${ctx.regime} × ${ctx.killzone} × ${ctx.setup}) : ` +
      `${comp.niveau} (${tradeLabel}${expLabel}). ${comp.raison || ''}`
    );
  }

  // 6. Seuils utilisés (si disponibles)
  if (trade.seuils_utilises) {
    parties.push('Seuils appliqués : ' + Object.entries(trade.seuils_utilises)
      .map(([k, v]) => `${k}=${v}`).join(', '));
  }

  return parties.join('\n');
}

/**
 * Explique l'état global du système : qu'est-ce qu'il sait, qu'est-ce qu'il
 * apprend, qu'est-ce qu'il ignore. Pour "état du système" dans le chat.
 */
async function expliquerEtat() {
  const etat = await Memoire.etat();
  const parties = [];

  parties.push(`Mémoire : ${etat.faits} fait(s) actif(s), ${etat.croyances} croyance(s), ${etat.exceptions} exception(s) active(s).`);
  parties.push(
    `Compétence : ${etat.competence.competent} contexte(s) maîtrisé(s), ` +
    `${etat.competence.moyen} moyen(s), ` +
    `${etat.competence.incompetent} à éviter, ` +
    `${etat.competence.inconnu} à explorer.`
  );

  // Top 3 croyances fortes
  const fortes = await Memoire.croyances.lister({ limit: 3 });
  if (fortes.length) {
    parties.push('Mes plus fortes croyances :');
    fortes.forEach((c, i) => {
      parties.push(`  ${i + 1}. ${c.description} — ${(Number(c.confiance) * 100).toFixed(0)}% confiance, ${c.trades} trades, expectancy ${c.expectancy}.`);
    });
  }

  // Exceptions actives
  const excs = await Memoire.exceptions.lister({ activesSeulement: true });
  if (excs.length) {
    parties.push('Mes règles d\'évitement :');
    excs.slice(0, 5).forEach(e => parties.push(`  - ${e.titre}`));
  }

  return parties.join('\n');
}

/**
 * Résume l'apprentissage d'une période.
 * @param {number} jours  période en jours
 */
async function resumerPeriode(jours = 7) {
  const Diff = require('./diff-versionne');
  const journaux = await Diff.listerJournaux(jours);
  if (!journaux.length) return `Pas de journaux sur les ${jours} derniers jours.`;

  const parties = [`Synthèse des ${journaux.length} derniers journaux d'apprentissage :`];
  for (const j of journaux.slice(0, 3)) {
    const date = j.replace('journal-', '').replace('.md', '');
    const contenu = await Diff.lireJournal(date);
    if (contenu) {
      // Extrait la première ligne après "## Hier j'ai appris"
      const match = contenu.match(/## Ce qui a marché\n([-*].+)\n/);
      if (match) parties.push(`- ${date} : ${match[1].replace(/^[-*]\s*/, '')}`);
    }
  }
  return parties.join('\n');
}

module.exports = { expliquerTrade, expliquerEtat, resumerPeriode };
