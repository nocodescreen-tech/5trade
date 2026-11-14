/**
 * 5trade — Apprentissage : point d'entrée unique.
 *
 * Initialise les dépendances (Memoire, post-mortem, seuils) et orchestre
 * la boucle quotidienne :
 *
 *   02:00 UTC : rejoue la veille PAR LE CERVEAU RÉEL → post-mortems → candidats
 *   03:00 UTC : publie le journal quotidien
 *   07:00 UTC : rétrograde les croyances anciennes
 *
 * Ce qui a changé (et pourquoi) :
 *   - le rejeu n'est plus un simulateur parallèle : il appelle `rejeu-cerveau`,
 *     qui utilise le générateur de scénarios et le module de structure du direct ;
 *   - les trades de la veille ne sont plus `[]` en dur : ils viennent du journal
 *     des signaux quand l'appelant n'en fournit pas ;
 *   - les métriques 14 j ne sont plus `{}` : elles se calculent sur les signaux
 *     clos du journal, avec la même définition du gain que l'écran ;
 *   - les candidats passent réellement par l'ajusteur (numérique OU bascule), et
 *     les shadow runs arrivés à échéance sont promus ou abandonnés.
 */

const Memoire = require('../memoire');
const PostMortem = require('../post-mortem/generateur');
const Rejoueur = require('./rejoueur-journalier');
const Cerveau = require('./rejeu-cerveau');
const Ajusteur = require('./ajusteur-seuils');
const Diff = require('./diff-versionne');
const Narrateur = require('./narrateur');
const Journal = require('../engine/journal-signaux');

const INSTRUMENTS = ['frxEURUSD', 'frxGBPUSD', 'frxUSDJPY', 'frxXAUUSD'];
const CLOS = new Set(['tp1', 'tp2', 'be', 'sl', 'expire']);
const JOUR_MS = 24 * 3600 * 1000;

async function init() {
  await Memoire.init();
  await Ajusteur.charger();  // initialise seuils.json si absent
  return true;
}

/** Les signaux clos du journal, du plus récent au plus ancien. */
function signauxClos(limite = 5000) {
  try {
    return Journal.lister({ limite }).filter(s => s && CLOS.has(s.resultat));
  } catch {
    return [];
  }
}

/**
 * Bilan 14 jours calculé sur les signaux réels — même définition que l'écran :
 * un gagné = tp1 ou tp2, un perdu = sl, BE et expirations hors du taux.
 */
function metricsDepuisJournal(jours = 14) {
  const depuis = Date.now() - jours * JOUR_MS;
  const clos = signauxClos().filter(s => {
    const t = Date.parse(s.cloture_at || s.at || s.entree_at || '');
    return Number.isFinite(t) && t >= depuis && Number.isFinite(Number(s.r));
  });
  if (!clos.length) return { expectancy: null, winRate: null, trades: 0, source: 'journal (0 signal clos)' };

  const rTotal = clos.reduce((a, s) => a + Number(s.r), 0);
  const gagnes = clos.filter(s => s.resultat === 'tp1' || s.resultat === 'tp2').length;
  const perdus = clos.filter(s => s.resultat === 'sl').length;
  const decides = gagnes + perdus;
  return {
    expectancy: +(rTotal / clos.length).toFixed(3),
    winRate: decides ? +(gagnes / decides).toFixed(3) : null,
    trades: clos.length,
    source: `journal (${clos.length} signaux clos)`
  };
}

/** Les signaux clos de la veille, au format attendu par le post-mortem. */
function tradesDeLaJournee(jour) {
  const debut = new Date(jour); debut.setUTCHours(0, 0, 0, 0);
  const fin = new Date(debut.getTime() + JOUR_MS);
  return signauxClos().filter(s => {
    const t = Date.parse(s.cloture_at || s.at || '');
    return Number.isFinite(t) && t >= debut.getTime() && t < fin.getTime();
  }).map(s => ({
    id: s.id,
    instrument: s.symbol,
    direction: s.sens || s.direction,
    entree_at: s.entree_at || (s.at ? new Date(s.at).toISOString() : null),
    cloture_at: s.cloture_at || null,
    entree_prix: s.entree,
    stop_prix: s.stop,
    tp1_prix: s.objectifs && s.objectifs[0],
    tp2_prix: s.objectifs && s.objectifs[1],
    issue: s.resultat,
    r_realise: Number(s.r),
    duree_minutes: Number(s.duree_minutes) || null,
    regime_entree: s.regime || null,
    killzone_entree: s.killzone || null,
    setup: s.nom || s.strategie || null
  }));
}

/** Agrège plusieurs rejeux en un bilan unique. */
function bilanRejeux(rejeux) {
  const trades = (rejeux || []).flatMap(r => (r && Array.isArray(r.trades) ? r.trades : []));
  if (!trades.length) return { n: 0, expectancyR: null, winRate: null, fraisConnus: false };
  const r = trades.reduce((a, t) => a + (Number(t.r_net) || 0), 0);
  const g = trades.filter(t => Number(t.r_net) > 0).length;
  return {
    n: trades.length,
    expectancyR: +(r / trades.length).toFixed(4),
    winRate: +((g / trades.length) * 100).toFixed(1),
    fraisConnus: trades.every(t => t.frais_connus === true)
  };
}

/**
 * Boucle quotidienne d'apprentissage.
 *
 * @param {object} deps
 * @param {object} [deps.market]        source de bougies (Market.getCandles)
 * @param {Array}  [deps.tradesVeille]  trades réellement exécutés hier (sinon : journal)
 * @param {object} [deps.metrics14j]    { expectancy, winRate, trades } (sinon : calculés)
 * @param {Date}   [deps.jour]          jour à rejouer (défaut : hier)
 */
async function boucleQuotidienne({ market, tradesVeille, metrics14j, jour } = {}) {
  const hier = jour ? new Date(jour) : new Date(Date.now() - JOUR_MS);

  // 1. Post-mortems des trades réels (fournis, sinon lus dans le journal).
  const trades = Array.isArray(tradesVeille) && tradesVeille.length ? tradesVeille : tradesDeLaJournee(hier);
  const candidats = [];
  for (const t of trades) {
    let pm;
    try { pm = await PostMortem.generer(t); } catch { continue; }
    if (pm.markdown) {
      try { await PostMortem.persisteMarkdown(pm.markdown, t.entree_at); } catch { /* disque : non bloquant */ }
    }
    candidats.push(...(pm.candidats_ajustement || []).map(c => ({ ...c, type: 'seuil', origine: 'post-mortem' })));
    if (t.regime_entree && t.killzone_entree) {
      try {
        await Memoire.croyances.observer(
          { regime: t.regime_entree, killzone: t.killzone_entree, setup: t.setup, instrument: t.instrument },
          `${t.instrument} ${t.direction} en ${t.regime_entree}/${t.killzone_entree}`,
          (Number(t.r_realise) || 0) > 0,
          Number(t.r_realise) || 0
        );
      } catch { /* mémoire indisponible : le rejeu continue */ }
    }
  }

  // 2. Rejeu des 4 instruments PAR LE CERVEAU RÉEL (mêmes modules que le direct).
  const seuils = await Ajusteur.charger();
  const rejeux = [];
  for (const instrument of INSTRUMENTS) {
    if (!market || typeof market.getCandles !== 'function') {
      rejeux.push({ instrument, trades: [], erreur: 'source de marché indisponible', motifs: ['pas de bougies : rejeu impossible'] });
      continue;
    }
    try {
      const h1 = await market.getCandles(instrument, '1h', 400);
      const m5 = await market.getCandles(instrument, '5m', 1500);
      const r = Cerveau.rejouer({ instrument, h1, m5, seuils });
      rejeux.push({ instrument, ...r });
      candidats.push(...Cerveau.candidatsDepuisMetrics(r.metrics, {
        minTrades: Ajusteur.LIMITES.tradesMinPourAjustement
      }));
    } catch (e) {
      rejeux.push({ instrument, trades: [], erreur: e.message, motifs: [`rejeu échoué : ${e.message}`] });
    }
  }

  // 3. Bilan réel : rejeu du jour + signaux réels sur 14 j.
  const bilan = bilanRejeux(rejeux);
  const mesures = (metrics14j && Object.keys(metrics14j).length) ? metrics14j : metricsDepuisJournal(14);

  // 4. Décisions d'ajustement (numérique ou bascule), une par candidat.
  const decisions = [];
  for (const c of candidats) {
    const preuve = c.preuve || { trades: Number(c.preuve && c.preuve.n) || 0 };
    const d = c.type === 'bascule'
      ? await Ajusteur.proposerBascule(c.parametre, c.valeurCandidate, { trades: Number(preuve.n) || 0, ...preuve })
      : await Ajusteur.proposer(c.parametre, Number(c.nouveau !== undefined ? c.nouveau : c.valeurCandidate));
    decisions.push({ ...c, ...d });
  }

  // 5. Shadow runs arrivés à échéance : promotion ou abandon, jamais oubli.
  const promotions = await Ajusteur.promouvoirEchues({
    expectancyR: Number.isFinite(Number(bilan.expectancyR)) ? Number(bilan.expectancyR) : Number(mesures.expectancy),
    trades: bilan.n || Number(mesures.trades) || 0
  });
  const shadow = await Ajusteur.shadowEnCours();

  // 6. Rétrograde les croyances anciennes.
  let retrogrades = [];
  try { retrogrades = await Memoire.croyances.retrograderAnciennes(); } catch { /* non bloquant */ }

  // 7. Publie le journal avec les VRAIS chiffres.
  const journal = await Diff.publierJournal({
    trades_veille: trades,
    candidats: decisions,
    promotions,
    shadow_runs: rejeux.filter(r => r && r.trades && r.trades.length).map(r => ({
      id: r.instrument,
      description: `rejeu cerveau réel — ${r.trades.length} trade(s), espérance ${r.metrics.expectancyR} R`,
      expectancy: r.metrics.expectancyR,
      trades: r.trades.length
    })),
    metrics_14j: {
      expectancy: mesures.expectancy,
      winRate: mesures.winRate,
      trades: mesures.trades
    },
    croyances_crees: [],
    croyances_retrogradees: [],
    exceptions_crees: [],
  });

  // 8. Garde-fou d'arrêt : espérance réelle négative → retour arrière recommandé.
  const expectancyReelle = Number(mesures.expectancy);
  if (Number.isFinite(expectancyReelle) && mesures.trades >= Ajusteur.LIMITES.tradesMinPourAjustement
      && expectancyReelle < Ajusteur.LIMITES.expectancyMin14j) {
    console.warn(`[apprentissage] espérance ${expectancyReelle} R sur ${mesures.trades} trades — retour arrière requis`);
  }

  return {
    candidats, rejeux, decisions, promotions, shadow, retrogrades, journal,
    bilan: { ...bilan, mesures14j: mesures }
  };
}

module.exports = {
  init, boucleQuotidienne,
  metricsDepuisJournal, tradesDeLaJournee, bilanRejeux,
  Memoire, PostMortem, Rejoueur, Cerveau, Ajusteur, Diff, Narrateur
};
