/**
 * 5trade — calendrier économique.
 *
 * Récupère les événements économiques à venir et détermine si un signal
 * doit être bloqué en fonction de l'impact des news.
 *
 * Sources : Forex Factory (scraping), avec cache de 15 minutes.
 */

const { fetchAvecReprise } = require('../core/reseau');

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
let cache = null;
let cacheTime = 0;

/**
 * Récupère le calendrier économique des prochaines 24h.
 * @returns {Promise<Array<{ date: string, heure: string, devise: string, impact: 'high'|'medium'|'low', titre: string, precedent: string, consigne: string }>>}
 */
async function getCalendar() {
  const { events } = await getCalendarAvecEtat();
  return events;
}

/**
 * Comme getCalendar, mais dit si la source a réellement répondu.
 *
 * Sans cette distinction, une panne de scraping renvoyait un tableau vide :
 * « aucune news à fort impact » et « je n'ai pas pu savoir » étaient
 * indiscernables — et le signal partait avec l'apparence de la sécurité.
 */
async function getCalendarAvecEtat() {
  const now = Date.now();
  if (cache && (now - cacheTime) < CACHE_TTL_MS) return { events: cache, sourceDisponible: true };

  try {
    const events = await scrapeForexFactory();
    cache = events;
    cacheTime = now;
    return { events, sourceDisponible: true };
  } catch (e) {
    console.error('   Calendrier  : échec —', e.message);
    // Un cache existant reste utilisable (donnée datée mais réelle) ; sans cache,
    // on assume l'ignorance au lieu de faire passer un tableau vide pour un avis.
    return { events: cache || [], sourceDisponible: Boolean(cache) };
  }
}

/**
 * Scrape le calendrier de Forex Factory.
 */
async function scrapeForexFactory() {
  // URL surchargeable : permet de tester le cas « source indisponible » sans
  // dépendre du réseau ni de la disponibilité réelle de Forex Factory.
  const url = process.env.CALENDRIER_URL || 'https://www.forexfactory.com/calendar?day=today';
  const res = await fetchAvecReprise(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  const html = await res.text();

  // Parsing simplifié du HTML de Forex Factory
  const events = [];
  const regex = /calendar__event[^>]*>[\s\S]*?calendar__date[^>]*>([^<]+)[\s\S]*?calendar__time[^>]*>([^<]+)[\s\S]*?calendar__currency[^>]*>([^<]+)[\s\S]*?calendar__impact[^>]*>[\s\S]*?calendar__title[^>]*>([^<]+)[\s\S]*?calendar__forecast[^>]*>([^<]*)[\s\S]*?calendar__previous[^>]*>([^<]*)/g;

  let match;
  while ((match = regex.exec(html)) !== null) {
    const [, date, heure, devise, impact, titre, forecast, previous] = match;
    const impactLevel = impact.includes('high') ? 'high'
      : impact.includes('medium') ? 'medium' : 'low';

    events.push({
      date: date.trim(),
      heure: heure.trim(),
      devise: devise.trim().toUpperCase(),
      impact: impactLevel,
      titre: titre.trim(),
      precedent: previous.trim(),
      consigne: forecast.trim()
    });
  }

  return events;
}

/**
 * Devises concernées par un symbole.
 *
 * `slice(0,3)` ne suffisait pas : EURUSD ne regardait que l'EUR et ignorait le
 * dollar, frxXAUUSD donnait « FRX », et BTCUSDT donnait « BTC ». On décompose
 * donc réellement la paire. Un indice synthétique Deriv (R_75, BOOM500…) n'a
 * aucune devise : le calendrier économique ne le concerne pas, et il faut le
 * dire au lieu de faire comme si le filtre avait répondu.
 */
function devisesDuSymbole(symbol) {
  const brut = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!brut) return { devises: [], applicable: false, raison: 'symbole vide' };

  // Indices synthétiques Deriv : R_10..R_100, BOOM/CRASH/STEP, 1HZ…
  if (/^(R|BOOM|CRASH|STEP|JD|STPRNG)\d*\d*$/.test(brut) || /^(BOOM|CRASH|STEP)\d+$/.test(brut)) {
    return { devises: [], applicable: false, raison: 'indice synthétique : aucune devise, calendrier non applicable' };
  }

  // frx / CFI / préfixes de courtier fréquents.
  const sansPrefixe = brut.replace(/^(FRX|CFI|FX|OTC)/, '');

  const DEVISES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD', 'CNH', 'MXN', 'ZAR', 'TRY', 'SEK', 'NOK'];
  const trouvees = [];
  let reste = sansPrefixe;
  // On reconnaît les devises par paires décroissantes de longueur (USDT avant USD).
  const CODES = [...DEVISES, 'USDT'].sort((a, b) => b.length - a.length);
  while (reste.length >= 3) {
    const code = CODES.find(c => reste.startsWith(c));
    if (!code) break;
    trouvees.push(code === 'USDT' ? 'USD' : code);
    reste = reste.slice(code.length);
  }
  if (trouvees.length >= 2) return { devises: [...new Set(trouvees)], applicable: true, raison: '' };

  // Métaux précieux : XAU/XAG ne sont pas des devises du calendrier, mais leur
  // cotation (USD le plus souvent) l'est — et c'est elle qui porte le risque news.
  const metal = sansPrefixe.match(/^(XAU|XAG)([A-Z]{3})$/);
  if (metal) return { devises: [metal[1], metal[2] === 'USDT' ? 'USD' : metal[2]], applicable: true, raison: 'métal coté en devises' };

  // Crypto / actions / matières premières sans paire de devises explicite.
  if (/^(BTC|ETH|XAU|XAG|US30|NAS|SPX|GER|UK100|JP225)/.test(sansPrefixe)) {
    return { devises: ['USD'], applicable: true, raison: 'instrument coté en dollars' };
  }
  return { devises: [], applicable: false, raison: `devises non identifiables pour « ${symbol} »` };
}

/**
 * Vérifie si une news à fort impact est imminente pour une devise donnée.
 *
 * Fenêtre : de -5 min (annonce qui vient de tomber, le temps que le marché
 * digère) à +fenetreMin. L'ancien code ne regardait qu'à venir, donc un signal
 * pouvait partir juste après une publication.
 *
 * @returns {{ bloque: boolean, raison: string, news: object|null, verifie: boolean }}
 */
async function newsImminente(devise, fenetreMin = 30) {
  const { events, sourceDisponible } = await getCalendarAvecEtat();
  if (!sourceDisponible) {
    return { bloque: false, raison: 'calendrier indisponible : filtre non vérifié', news: null, verifie: false };
  }
  const now = new Date();
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const code = String(devise || '').toUpperCase();

  for (const ev of events) {
    if (ev.impact !== 'high') continue;
    // Égalité sur les codes : « includes » rapprochait des devises distinctes.
    const concernes = String(ev.devise || '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
    if (!concernes.includes(code)) continue;

    const [h, m] = String(ev.heure || '').split(':').map(Number);
    if (isNaN(h) || isNaN(m)) continue;          // « All Day » : heure inconnue

    const diff = (h * 60 + m) - nowMinutes;
    if (diff >= -5 && diff <= fenetreMin) {
      return {
        bloque: true,
        raison: diff >= 0
          ? `News à fort impact dans ${diff} min : ${ev.titre}`
          : `News à fort impact publiée il y a ${-diff} min : ${ev.titre}`,
        news: ev,
        verifie: true
      };
    }
  }

  return { bloque: false, raison: '', news: null, verifie: true };
}

/**
 * Filtre les signaux selon le calendrier économique.
 *
 * Retourne toujours un état EXPLICITE : `verifie` dit si le filtre a réellement
 * pu s'appliquer. Un calendrier injoignable ne doit ni bloquer en silence, ni
 * laisser croire que tout va bien.
 */
async function filtreCalendrier(symbol) {
  const { devises, applicable, raison } = devisesDuSymbole(symbol);

  if (!applicable) {
    return {
      ok: true, verifie: false, bloque: false, applicable: false,
      devises: [], detail: raison,
      lecture: `filtre économique non applicable (${raison})`
    };
  }

  for (const devise of devises) {
    const r = await newsImminente(devise, 30);
    if (!r.verifie) {
      return {
        ok: true, verifie: false, bloque: false, applicable: true, devises,
        detail: r.raison,
        lecture: 'filtre économique NON vérifié : calendrier indisponible — le signal n\'est pas bloqué, mais la prudence est requise'
      };
    }
    if (r.bloque) {
      return {
        ok: false, verifie: true, bloque: true, applicable: true, devises,
        detail: r.raison, news: r.news,
        lecture: `${devise} — ${r.raison} : signal bloqué`
      };
    }
  }

  return {
    ok: true, verifie: true, bloque: false, applicable: true, devises,
    detail: `aucune news à fort impact sous 30 min (${devises.join('/')})`,
    lecture: `calendrier vérifié pour ${devises.join(' et ')} : aucune annonce imminente`
  };
}

/**
 * Vide le cache (forcer un rafraîchissement).
 */
function viderCache() {
  cache = null;
  cacheTime = 0;
}

module.exports = { getCalendar, getCalendarAvecEtat, newsImminente, filtreCalendrier, devisesDuSymbole, viderCache };
