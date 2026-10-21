/**
 * 5trade — ACTUALITÉS ET CALENDRIER ÉCONOMIQUE.
 *
 * Un système de trading qui ignore les news trade dans le vide : une annonce
 * d'inflation ou une décision de taux décroche un stop en une bougie, et le
 * graphique ne l'avait pas dit. Cette couche apporte le contexte extérieur.
 *
 * Contrainte tenue : **aucune API payante, aucune clé**. Uniquement des flux
 * publics :
 *   • RSS de presse crypto / forex / matières premières (gratuits, sans compte) ;
 *   • calendrier économique hebdomadaire ForexFactory (JSON public).
 *
 * Tout passe par `fetchAvecReprise` (règle du projet : la connexion est lente,
 * pas cassée). Un flux qui tombe n'empêche pas les autres de répondre, et le
 * dernier résultat valide est conservé : une page vide serait pire qu'une page
 * légèrement datée, à condition de dire de quand elle date.
 */

const { fetchAvecReprise } = require('./reseau');

// ─── Sources ─────────────────────────────────────────────────────────────
// `marches` sert au filtrage par actif. On reste factuel : on ne devine pas un
// sentiment, on ne classe pas « haussier / baissier » — ce serait une opinion
// déguisée en donnée.
const FLUX_RSS = [
  { id: 'coindesk', nom: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', marches: ['crypto'], langue: 'en' },
  { id: 'cointelegraph', nom: 'Cointelegraph', url: 'https://cointelegraph.com/rss', marches: ['crypto'], langue: 'en' },
  { id: 'bitcoinmagazine', nom: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed', marches: ['crypto'], langue: 'en' },
  { id: 'fxstreet', nom: 'FXStreet', url: 'https://www.fxstreet.com/rss/news', marches: ['forex'], langue: 'en' },
  { id: 'forexlive', nom: 'ForexLive', url: 'https://www.forexlive.com/feed/news', marches: ['forex'], langue: 'en' },
  { id: 'investing', nom: 'Investing.com', url: 'https://www.investing.com/rss/news_1.rss', marches: ['macro'], langue: 'en' }
];

// Mots qui rattachent une dépêche à un actif ou à un thème. Volontairement
// simples : un mot-clé trouvé dans le titre ou le résumé suffit à étiqueter.
const MOTS = {
  BTC: ['bitcoin', 'btc'],
  ETH: ['ethereum', 'ether', ' eth '],
  SOL: ['solana'],
  XRP: ['xrp', 'ripple'],
  // « or » et « argent » tout court sont des faux positifs en anglais (« or »
  // est une conjonction, « argent » est le début d'« Argentina ») : mesuré, un
  // article de la RBA ressortait étiqueté XAU. On ne garde que des formes
  // d'actif explicites.
  XAU: ['gold', 'xauusd', 'bullion'],
  XAG: ['silver', 'xagusd'],
  EUR: ['euro', 'eur/usd', 'ecb', 'bce'],
  USD: ['dollar', 'fed', 'fomc', 'powell', 'treasury'],
  INDICES: ['nasdaq', 's&p', 'dow', 'cac', 'dax']
};

const MOTS_IMPACT = [
  'cpi', 'inflation', 'nfp', 'payroll', 'nonfarm', 'fomc', 'rate decision', 'taux',
  'gdp', 'pib', 'recession', 'récession', 'etf', 'hack', 'exploit', 'faillite',
  'bankruptcy', 'liquidat', 'sec approval', 'halving', 'tariff', 'droits de douane'
];

const CACHE_MS = 5 * 60 * 1000;        // les flux bougent vite, mais pas à la seconde
const CACHE_CALENDRIER_MS = 30 * 60 * 1000;
const MAX_ITEMS = 120;

let cacheFlux = { at: 0, items: [], sources: {} };
let cacheCalendrier = { at: 0, jours: [] };

// ─── Utilitaires ─────────────────────────────────────────────────────────
const sansBalises = s => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function balise(bloc, noms) {
  for (const n of noms) {
    const m = bloc.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, 'i'));
    if (m) {
      const v = sansBalises(m[1]);
      if (v) return v;
    }
    // Balise auto-fermante avec attribut href (Atom : <link href="..."/>)
    const a = bloc.match(new RegExp(`<${n}[^>]*href="([^"]+)"`, 'i'));
    if (a) return a[1];
  }
  return null;
}

function dateDe(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** Étiquettes d'un texte : actifs cités + intensité de l'info. */
function etiqueter(texte) {
  const t = ' ' + String(texte || '').toLowerCase() + ' ';
  const actifs = [];
  for (const [cle, mots] of Object.entries(MOTS)) {
    if (mots.some(m => t.includes(m))) actifs.push(cle);
  }
  const impact = MOTS_IMPACT.some(m => t.includes(m));
  return { actifs, impact };
}

/** Analyse un XML RSS/Atom en liste d'articles. */
function lireFlux(xml, source) {
  const out = [];
  const blocs = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  for (const bloc of blocs) {
    const titre = balise(bloc, ['title']);
    const lien = balise(bloc, ['link', 'guid', 'id']);
    const date = dateDe(balise(bloc, ['pubDate', 'published', 'updated', 'dc:date']));
    const resume = balise(bloc, ['description', 'summary', 'content:encoded', 'content']);
    if (!titre || !lien) continue;
    const { actifs, impact } = etiqueter(`${titre} ${resume || ''}`);
    out.push({
      titre: titre.slice(0, 240),
      lien,
      date: date || null,
      resume: (resume || '').slice(0, 400),
      source: source.nom,
      sourceId: source.id,
      marches: source.marches,
      actifs,
      impact
    });
  }
  return out;
}

// ─── Flux de presse ──────────────────────────────────────────────────────
async function chargerFlux(force = false) {
  if (!force && Date.now() - cacheFlux.at < CACHE_MS && cacheFlux.items.length) {
    return { ...cacheFlux, cache: true };
  }

  const resultats = await Promise.all(FLUX_RSS.map(async (src) => {
    try {
      const r = await fetchAvecReprise(src.url, {
        headers: { 'User-Agent': '5trade/1.0 (+veille de marche)', Accept: 'application/rss+xml, application/xml, text/xml' }
      }, 2);
      if (!r.ok) return { src, articles: [], erreur: `HTTP ${r.status}` };
      const xml = await r.text();
      return { src, articles: lireFlux(xml, src) };
    } catch (e) {
      return { src, articles: [], erreur: e.message };
    }
  }));

  const sources = {};
  let items = [];
  for (const { src, articles, erreur } of resultats) {
    sources[src.id] = { nom: src.nom, articles: articles.length, erreur: erreur || null };
    items.push(...articles);
  }

  // Dédoublonnage par titre normalisé : les agences republient les mêmes dépêches.
  const vus = new Set();
  items = items.filter(a => {
    const cle = a.titre.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 90);
    if (vus.has(cle)) return false;
    vus.add(cle);
    return true;
  }).sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, MAX_ITEMS);

  // Si tout tombe, on garde le dernier résultat valide plutôt que de rendre du vide.
  if (!items.length && cacheFlux.items.length) {
    return { ...cacheFlux, cache: true, degrade: true, sources };
  }

  cacheFlux = { at: Date.now(), items, sources };
  return { ...cacheFlux, cache: false };
}

// ─── Calendrier économique ───────────────────────────────────────────────
// ForexFactory publie un JSON hebdomadaire public, sans clé ni compte.
const URL_CALENDRIER = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

function normaliserEvenement(e) {
  const date = dateDe(e.date);
  const impact = String(e.impact || '').toLowerCase();
  return {
    titre: String(e.title || '').slice(0, 200),
    pays: String(e.country || '').toUpperCase(),
    devise: String(e.currency || '').toUpperCase(),
    date,
    impact: impact === 'high' ? 'élevé' : impact === 'medium' ? 'moyen' : impact === 'low' ? 'faible' : 'inconnu',
    impactNiveau: impact === 'high' ? 3 : impact === 'medium' ? 2 : impact === 'low' ? 1 : 0,
    precedent: e.previous || null,
    prevision: e.forecast || null,
    reel: e.actual || null
  };
}

async function chargerCalendrier(force = false) {
  if (!force && Date.now() - cacheCalendrier.at < CACHE_CALENDRIER_MS && cacheCalendrier.jours.length) {
    return { ...cacheCalendrier, cache: true };
  }
  try {
    const r = await fetchAvecReprise(URL_CALENDRIER, {
      headers: { 'User-Agent': '5trade/1.0', Accept: 'application/json' }
    }, 2);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const brut = await r.json();
    const evts = (Array.isArray(brut) ? brut : []).map(normaliserEvenement)
      .filter(e => Number.isFinite(e.date))
      .sort((a, b) => a.date - b.date);

    const cache = { at: Date.now(), evenements: evts };
    cacheCalendrier = cache;
    return { ...cache, cache: false };
  } catch (e) {
    if (cacheCalendrier.evenements) {
      return { ...cacheCalendrier, cache: true, degrade: true, erreur: e.message };
    }
    return { at: Date.now(), evenements: [], erreur: e.message };
  }
}

/** Regroupe les événements par jour, en ne gardant que les jours utiles. */
function parJour(evenements, { impactMin = 0 } = {}) {
  const jours = new Map();
  for (const e of evenements) {
    if (e.impactNiveau < impactMin) continue;
    const d = new Date(e.date);
    const cle = d.toISOString().slice(0, 10);
    if (!jours.has(cle)) jours.set(cle, []);
    jours.get(cle).push(e);
  }
  return [...jours.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([jour, liste]) => ({ jour, evenements: liste }));
}

/**
 * Vue d'ensemble pour l'écran.
 * @param {{marche?:string, impactMin?:number, force?:boolean}} [options]
 */
async function panorama(options = {}) {
  const [flux, calendrier] = await Promise.all([
    chargerFlux(options.force),
    chargerCalendrier(options.force)
  ]);

  let articles = flux.items || [];
  if (options.marche && options.marche !== 'tout') {
    const m = options.marche === 'crypto' ? 'crypto' : options.marche === 'forex' ? 'forex' : 'macro';
    articles = articles.filter(a => (a.marches || []).includes(m) || (a.actifs || []).includes(options.marche.toUpperCase()));
  }

  const impactMin = Number.isFinite(options.impactMin) ? options.impactMin : 0;
  const maintenant = Date.now();

  return {
    at: Date.now(),
    articles: articles.slice(0, 80),
    calendrier: parJour(calendrier.evenements || [], { impactMin }),
    // Ce qui arrive dans les 24 h : c'est ce qui doit empêcher d'ouvrir un trade
    // juste avant une annonce.
    prochaines24h: (calendrier.evenements || [])
      .filter(e => e.date >= maintenant && e.date <= maintenant + 86400000)
      .sort((a, b) => a.date - b.date)
      .slice(0, 12),
    sources: flux.sources || {},
    etat: {
      fluxAt: flux.at || null,
      calendrierAt: calendrier.at || null,
      fluxEnCache: !!flux.cache,
      calendrierEnCache: !!calendrier.cache,
      degrade: !!(flux.degrade || calendrier.degrade),
      erreurs: [flux.erreur, calendrier.erreur].filter(Boolean)
    }
  };
}

module.exports = {
  panorama, chargerFlux, chargerCalendrier, lireFlux, etiqueter, parJour,
  FLUX_RSS, URL_CALENDRIER, MOTS, MOTS_IMPACT, sansBalises
};
