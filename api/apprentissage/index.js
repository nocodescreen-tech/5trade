/**
 * 5trade — Apprentissage : point d'entrée unique.
 *
 * Initialise les dépendances (Memoire, post-mortem, seuils) et orchestre
 * la boucle quotidienne :
 *
 *   02:00 UTC : rejoue la veille → génère post-mortems → propose ajustements
 *   03:00 UTC : publie le journal quotidien
 *   07:00 UTC : rétrograde les croyances anciennes
 */

const Memoire = require('../memoire');
const PostMortem = require('../post-mortem/generateur');
const Rejoueur = require('./rejoueur-journalier');
const Ajusteur = require('./ajusteur-seuils');
const Diff = require('./diff-versionne');
const Narrateur = require('./narrateur');

async function init() {
  await Memoire.init();
  await Ajusteur.charger();  // initialise seuils.json si absent
  return true;
}

/**
 * Boucle quotidienne d'apprentissage.
 * À appeler par un cron interne ou un setInterval à 02:00 UTC.
 *
 * @param {object} deps
 * @param {object} deps.market         source de bougies (Market.getCandles)
 * @param {Array}  deps.tradesVeille   trades réellement exécutés hier
 * @param {object} deps.metrics14j     { expectancy, winRate, trades }
 */
async function boucleQuotidienne({ market, tradesVeille = [], metrics14j = {} }) {
  const hier = new Date(Date.now() - 24 * 3600 * 1000);

  // 1. Post-mortems pour les trades réels de la veille
  const candidats = [];
  for (const t of tradesVeille) {
    const pm = await PostMortem.generer(t);
    if (pm.markdown) await PostMortem.persisteMarkdown(pm.markdown, t.entree_at);
    candidats.push(...pm.candidats_ajustement);
    // Enregistre la croyance
    if (t.regime_entree && t.killzone_entree) {
      await Memoire.croyances.observer(
        { regime: t.regime_entree, killzone: t.killzone_entree, setup: t.setup, instrument: t.instrument },
        `${t.instrument} ${t.direction} en ${t.regime_entree}/${t.killzone_entree}`,
        (Number(t.r_realise) || 0) > 0,
        Number(t.r_realise) || 0
      );
    }
  }

  // 2. Rejeu des 4 instruments avec les seuils actuels
  const instruments = ['frxEURUSD', 'frxGBPUSD', 'frxUSDJPY', 'frxXAUUSD'];
  const seuils = await Ajusteur.charger();
  const rejeux = [];
  for (const instr of instruments) {
    try {
      const r = await Rejoueur.rejouerJournee({
        instrument: instr, jour: hier, seuils, market
      });
      rejeux.push({ instrument: instr, ...r });
    } catch (e) {
      rejeux.push({ instrument: instr, erreur: e.message });
    }
  }

  // 3. Rétrograde les croyances anciennes
  const retrogrades = await Memoire.croyances.retrograderAnciennes();

  // 4. Publie le journal
  const journal = await Diff.publierJournal({
    trades_veille: tradesVeille,
    candidats,
    promotions: [],
    shadow_runs: rejeux.filter(r => r.trades && r.trades.length > 0).map(r => ({
      id: r.instrument, description: 'rejeu journee', expectancy: r.expectancy, trades: r.trades.length
    })),
    metrics_14j: metrics14j,
    croyances_crees: [],
    croyances_retrogradees: [],
    exceptions_crees: [],
  });

  // 5. Si expectancy 14j < 0 : retour arrière
  if (metrics14j.expectancy !== undefined && metrics14j.expectancy < 0) {
    // En production : charger le snapshot d'il y a 14j
    console.warn('[apprentissage] expectancy 14j négative — retour arrière recommandé');
  }

  return { candidats, rejeux, retrogrades, journal };
}

module.exports = { init, boucleQuotidienne, Memoire, PostMortem, Rejoueur, Ajusteur, Diff, Narrateur };
