/**
 * 5trade — Post-mortem automatique.
 *
 * Pour chaque trade clôturé, génère une analyse rétroactive :
 *   - la décision était-elle BONNE ou MAUVAISE ?
 *   - qu'est-ce qui aurait pu être mieux ?
 *   - quels paramètres ajuster ?
 *
 * Sortie : un objet structuré + un markdown lisible par humain.
 * Le structuré alimente `apprentissage/ajusteur-seuils.js`.
 * Le markdown est stocké dans `data/post-mortems/YYYY-MM-DD.md`.
 */

const fs = require('fs').promises;
const path = require('path');
const ATR = require('../atr-unifie');
const { niveauCompetence } = require('../memoire/croyances');

/**
 * Génère un post-mortem pour un trade clôturé.
 *
 * @param {object} trade
 *   { instrument, direction, entree_prix, entree_at, stop_prix, tp1_prix, tp2_prix,
 *     clotre_at, issue, r_realise, slippage_pips, duree_minutes,
 *     regime_entree, killzone_entree, conditions_valides, conditions_manquantes,
 *     frais_appliques, candles_entree }
 *
 * @returns {Promise<{verdict:string, lecons:Array, candidats_ajustement:Array, markdown:string}>}
 */
async function generer(trade) {
  if (!trade || !trade.issue) {
    return { verdict: 'indetermine', lecons: [], candidats_ajustement: [], markdown: 'Trade incomplet.' };
  }

  const lecons = [];
  const candidats = [];
  const gagnant = ['tp1', 'tp2', 'runner', 'breakeven'].includes(trade.issue);
  const verdict = gagnant ? 'BONNE' : 'MAUVAISE';

  // 1. Verdict de base
  if (gagnant) {
    lecons.push(`Trade gagnant (${trade.issue}), R réalisé ${trade.r_realise}.`);
  } else {
    lecons.push(`Trade perdant (${trade.issue}), R réalisé ${trade.r_realise}.`);
  }

  // 2. Slippage
  if (trade.slippage_pips !== undefined && trade.slippage_pips > 1.5) {
    lecons.push(`Slippage élevé : ${trade.slippage_pips} pips. L'entrée était précipitée ou le marché volatile.`);
    candidats.push({
      parametre: 'execution.delai_max_secondes',
      ancien: 5,
      nouveau: 3,
      raison: `slippage ${trade.slippage_pips} pips sur ${trade.instrument}`,
      impact_estime: 'réduction du slippage moyen'
    });
  }

  // 3. Stop trop serré ?
  if (trade.candles_entree && trade.candles_entree.length > 20) {
    const atrEntree = ATR.atr(trade.candles_entree.slice(-30), 14);
    if (atrEntree) {
      const stopDistance = Math.abs(trade.entree_prix - trade.stop_prix);
      const ratioStopAtr = stopDistance / atrEntree;
      // Le prix a-t-il touché le stop avant de remonter ?
      const toucherStopAvantRetour = trade.issue === 'stop' ||
        (gagnant && trade.candles_entree.some(c =>
          trade.direction === 'long'
            ? c.l <= trade.stop_prix + atrEntree * 0.2
            : c.h >= trade.stop_prix - atrEntree * 0.2
        ));

      if (toucherStopAvantRetour && ratioStopAtr < 0.8) {
        lecons.push(`Stop trop serré : ${ratioStopAtr.toFixed(2)} × ATR. Le prix a flirté avec le stop.`);
        candidats.push({
          parametre: `stop.atr_multiplier[${trade.instrument}]`,
          ancien: 1.0,
          nouveau: 1.1,
          raison: `stop ${ratioStopAtr.toFixed(2)}×ATR insuffisant`,
          impact_estime: 'évite 5-10% de stops prématurés'
        });
      }
      if (ratioStopAtr > 1.5 && !gagnant) {
        lecons.push(`Stop trop large : ${ratioStopAtr.toFixed(2)} × ATR. Perte supérieure à la normale.`);
        candidats.push({
          parametre: `stop.atr_multiplier[${trade.instrument}]`,
          ancien: 1.0,
          nouveau: 0.9,
          raison: `stop ${ratioStopAtr.toFixed(2)}×ATR excessif`,
          impact_estime: 'réduit la taille des pertes'
        });
      }
    }
  }

  // 4. Durée : trade expiré par timeout ?
  if (trade.issue === 'timeout' || (trade.duree_minutes > 180 && !gagnant)) {
    lecons.push(`Trade long sans issue favorable (${trade.duree_minutes} min). Invalidation temporelle tardive.`);
    candidats.push({
      parametre: 'gestion.invalidation_temporelle_minutes',
      ancien: 180,
      nouveau: 150,
      raison: `timeout à ${trade.duree_minutes} min`,
      impact_estime: 'coupe plus vite les trades stagnants'
    });
  }

  // 5. Conditions manquantes
  if (Array.isArray(trade.conditions_manquantes) && trade.conditions_manquantes.length > 0) {
    lecons.push(`Conditions manquantes à l'entrée : ${trade.conditions_manquantes.join(', ')}. Le déclencheur était peut-être trop permissif.`);
  }

  // 6. Niveau de compétence sur le contexte
  if (trade.regime_entree && trade.killzone_entree) {
    const ctx = {
      regime: trade.regime_entree,
      killzone: trade.killzone_entree,
      setup: trade.setup || 'standard',
      instrument: trade.instrument
    };
    const comp = await niveauCompetence(ctx);
    if (comp.niveau === 'incompetent' && gagnant) {
      lecons.push(`Trade gagnant dans un contexte habituellement perdant (${comp.trades} trades, expectancy ${comp.expectancy}). Chance ou changement de régime ?`);
    } else if (comp.niveau === 'competent' && !gagnant) {
      lecons.push(`Trade perdant dans un contexte habituellement gagnant (${comp.trades} trades, expectancy ${comp.expectancy}). Anomalie à surveiller.`);
    }
  }

  // 7. Frais
  if (trade.frais_appliques && trade.frais_appliques.total > 0) {
    const ratioFrais = Math.abs(trade.frais_appliques.total / (trade.r_realise || 1));
    if (ratioFrais > 0.3) {
      lecons.push(`Frais élevés : ${trade.frais_appliques.total} (${(ratioFrais * 100).toFixed(0)}% du R). Le trade était marginal.`);
    }
  }

  // 8. Markdown lisible
  const markdown = genererMarkdown(trade, verdict, lecons, candidats);

  return { verdict, lecons, candidats_ajustement: candidats, markdown };
}

function genererMarkdown(trade, verdict, lecons, candidats) {
  const date = new Date(trade.entree_at).toISOString().slice(0, 10);
  const lignes = [
    `# Post-mortem — ${trade.instrument} ${trade.direction} — ${date}`,
    '',
    `## Trade #${trade.id || '?'}`,
    '',
    `- **Entrée** : ${trade.entree_prix} à ${new Date(trade.entree_at).toISOString()}`,
    `- **Stop** : ${trade.stop_prix}`,
    `- **TP1** : ${trade.tp1_prix}`,
    `- **TP2** : ${trade.tp2_prix}`,
    `- **Issue** : ${trade.issue}`,
    `- **R réalisé** : ${trade.r_realise}`,
    `- **Durée** : ${trade.duree_minutes} min`,
    `- **Slippage** : ${trade.slippage_pips || 0} pips`,
    `- **Régime** : ${trade.regime_entree || '?'}`,
    `- **Killzone** : ${trade.killzone_entree || '?'}`,
    '',
    '## Verdict',
    '',
    `**${verdict}**`,
    '',
    '## Leçons',
    '',
    ...lecons.map(l => `- ${l}`),
    '',
    '## Candidats d\'ajustement',
    '',
    ...(candidats.length === 0
      ? ['- Aucun candidat — le trade s\'est déroulé dans les normes.']
      : candidats.map(c =>
        `- \`${c.parametre}\` : ${c.ancien} → ${c.nouveau} (${c.raison}) — impact: ${c.impact_estime}`)),
    '',
    '---',
    ''
  ];
  return lignes.join('\n');
}

/**
 * Persiste le markdown dans data/post-mortems/YYYY-MM-DD.md.
 * Si le fichier existe déjà pour la journée, ajoute à la suite.
 */
async function persisteMarkdown(contenu, dateAt) {
  const dir = path.join(process.env.DATA_DIR || './data', 'post-mortems');
  await fs.mkdir(dir, { recursive: true });
  const fichier = path.join(dir, `${new Date(dateAt).toISOString().slice(0, 10)}.md`);
  try {
    const existant = await fs.readFile(fichier, 'utf8').catch(() => '');
    await fs.writeFile(fichier, existant + contenu);
    return fichier;
  } catch (e) {
    console.error('post-mortem persiste :', e.message);
    return null;
  }
}

module.exports = { generer, persisteMarkdown };
