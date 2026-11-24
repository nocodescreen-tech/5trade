/**
 * Compare des setups independamment par marche et regime.
 *
 * Ce module ne choisit jamais un gagnant. Il produit la matrice complete,
 * y compris les couples refuses, afin que la recherche ne transforme pas un
 * indicateur ou un setup en filtre universel.
 */

const Backtest = require('../engine/backtest');
const Signals = require('../engine/signals');
const Validite = require('../core/validite');
const { filtrerParClasse } = require('../strategy-engine/strategy-contract');

const CLOS = new Set(['tp1', 'tp2', 'be', 'sl', 'expire']);

function statistiques(resultat) {
  const rendements = ((resultat && resultat.trades) || [])
    .filter(t => CLOS.has(t.resultat) && Number.isFinite(Number(t.r)))
    .map(t => Number(t.r));
  const totalR = rendements.reduce((a, r) => a + r, 0);
  return {
    trades: rendements.length,
    totalR: +totalR.toFixed(4),
    esperance: rendements.length ? +(totalR / rendements.length).toFixed(4) : null,
    sharpe: rendements.length > 1 ? +Validite.sharpe(rendements).toFixed(4) : null,
    psr: rendements.length > 2 ? Validite.psr(rendements) : null,
    rendements
  };
}

function raisonCompatibilite(setup, marche, profil) {
  const classe = filtrerParClasse([setup], marche.symbol, marche.meta || {});
  if (!(classe.compatibles || []).some(s => s.id === setup.id)) {
    const refuse = (classe.refusees || []).find(s => s.id === setup.id);
    return refuse ? refuse.raison : 'marche non declare par le setup';
  }
  if (Array.isArray(profil.regimes) && profil.regimes.length) {
    const regime = marche.regime ? String(marche.regime).toLowerCase() : null;
    if (!regime || regime === 'unknown') return 'regime non determine';
    if (!profil.regimes.includes(regime)) {
      return `regime incompatible (${regime} vs ${profil.regimes.join(',')})`;
    }
  }
  return null;
}

function comparer({ setups = [], marches = [], ratio = 0.6, backtester = Backtest.lancer } = {}) {
  const limite = Math.min(0.8, Math.max(0.5, Number(ratio) || 0.6));
  const lignes = [];

  for (const marche of marches) {
    const serie = (marche.candles || []).filter(c => c && Number.isFinite(c.t))
      .slice().sort((a, b) => a.t - b.t);
    for (const setup of setups) {
      const profil = Signals.profilDepuisStrategie(setup);
      const base = {
        setup: setup.id || null,
        titre: setup.title || setup.name || setup.id || 'setup',
        symbol: marche.symbol || null,
        timeframe: marche.timeframe || null,
        regime: marche.regime || null
      };
      if (!profil.executable) {
        lignes.push({ ...base, statut: 'refuse', raison: profil.motif || 'setup non executable' });
        continue;
      }
      const raison = raisonCompatibilite(setup, marche, profil);
      if (raison) {
        lignes.push({ ...base, statut: 'refuse', raison });
        continue;
      }
      if (serie.length < 80) {
        lignes.push({ ...base, statut: 'refuse', raison: `historique insuffisant (${serie.length}/80)` });
        continue;
      }

      const coupe = Math.floor(serie.length * limite);
      const meta = { ...(marche.meta || {}), symbol: marche.symbol, timeframe: marche.timeframe };
      const options = {
        profils: [profil], frais: marche.frais || null, limiteTrades: 1e6,
        plafond: 20000, pas: marche.pas || 2
      };
      const dans = backtester(serie.slice(0, coupe), meta,
        { ...options, maxBougies: coupe });
      const hors = backtester(serie.slice(coupe), meta,
        { ...options, maxBougies: serie.length - coupe });
      lignes.push({
        ...base,
        statut: 'evalue',
        separation: { ratio: limite, at: serie[coupe] ? serie[coupe].t : null },
        is: statistiques(dans),
        oos: statistiques(hors)
      });
    }
  }

  return {
    essais: setups.length * marches.length,
    evalues: lignes.filter(l => l.statut === 'evalue').length,
    refuses: lignes.filter(l => l.statut === 'refuse').length,
    lignes
  };
}

module.exports = { comparer, statistiques, raisonCompatibilite };
