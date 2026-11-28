'use strict';

const { classifier } = require('../market-intelligence/instrument-classifier');
const { statutMarche } = require('../temporal/sessions');
const { devisesDuSymbole } = require('../sources/fundamentals');

function sampleVolatility(xs) {
  if (xs.length < 2) return null;
  const mean = xs.reduce((a,b)=>a+b,0)/xs.length;
  return Math.sqrt(xs.reduce((a,b)=>a+(b-mean)**2,0)/(xs.length-1));
}

function common(closes, meta) {
  if (!Array.isArray(closes) || closes.length < 30 || closes.some(p=>!Number.isFinite(p)||p<=0)) {
    return { convient: false, refus: ['30 clôtures numériques positives consécutives requises'], faits: [], statistiques: null, regime: 'unknown' };
  }
  const returns = closes.slice(1).map((x,i)=>Math.log(x/closes[i]));
  const vol = sampleVolatility(returns);
  const recent = sampleVolatility(returns.slice(-14));
  const reference = sampleVolatility(returns.slice(0,-14));
  const ratio = reference > 0 ? recent/reference : null;
  const momentum = Math.log(closes.at(-1)/closes.at(-15));
  return { convient: vol > 0, refus: vol > 0 ? [] : ['Série figée'],
    faits: [], regime: ratio === null ? 'unknown' : ratio > 1.5 ? 'agite' : ratio < 0.67 ? 'calme' : 'normal',
    statistiques: { volatilite: vol, ratioVolatilite: ratio, momentum14: momentum, observations: returns.length } };
}

function analyse(classe, closes, meta = {}) {
  const base = common(closes,meta);
  const info = classifier(meta.symbol, {provider:meta.provider});
  const session = Number.isFinite(meta.now) ? statutMarche(meta.symbol,meta.now) : null;
  const candles = Array.isArray(meta.candles) ? meta.candles : [];
  const last = candles.at(-1);
  const prior = candles.at(-2);
  const result = { ...base, famille: classe, contexte: { instrument: info, session }, manquants: [] };
  if (info.classe !== classe) {
    result.convient = false;
    result.refus.push('Classe de marché contradictoire');
  }
  if (session && !session.ouvert) {
    result.faits.push(session.raison);
    if (meta.live === true) { result.convient = false; result.refus.push(session.raison); }
  }
  if (classe === 'forex' || classe === 'metaux' || classe === 'energies') {
    const currencies = devisesDuSymbole(meta.symbol);
    result.contexte.devises = currencies.devises;
    result.contexte.macro = meta.macro || null;
    if (!meta.macro?.verifie) result.manquants.push('Calendrier vérifié');
    if (classe === 'forex') result.manquants.push('Force relative multi-devises');
    if (classe === 'metaux') result.manquants.push('Rendements US, dollar, coûts de portage');
    if (classe === 'energies') result.manquants.push('Stocks, offre et demande, calendrier énergie');
  }
  if (classe === 'crypto' || classe === 'indices') {
    const volumes = candles.slice(-20).map(c=>c.v);
    if (volumes.length === 20 && volumes.every(v=>Number.isFinite(v)&&v>=0) && volumes.some(v=>v>0)) {
      const avg = volumes.slice(0,-1).reduce((a,b)=>a+b,0)/19;
      result.contexte.volumeRelatif = avg > 0 ? volumes.at(-1)/avg : null;
    } else result.manquants.push('Volume fournisseur exploitable');
    if (classe === 'crypto') result.manquants.push('Carnet, funding et open interest selon contrat');
    if (classe === 'indices') {
      result.contexte.gapDerniereBougie = Number.isFinite(last?.o) && Number.isFinite(prior?.c) && prior.c !== 0 ? last.o/prior.c-1 : null;
      result.manquants.push('Calendrier officiel de la bourse et gap de séance');
    }
  }
  result.faits.push('Diagnostic descriptif ; aucun avantage statistique ni direction prédictive démontrés.');
  return result;
}

module.exports = { analyse, sampleVolatility };
