/**
 * 5trade — calendrier économique.
 *
 * Récupère les événements économiques à venir et détermine si un signal
 * doit être bloqué en fonction de l'impact des news.
 *
 * Sources : Forex Factory (scraping), avec cache de 15 minutes.
 */

const { fetchAvecReprise } = require('./reseau');

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
let cache = null;
let cacheTime = 0;

/**
 * Récupère le calendrier économique des prochaines 24h.
 * @returns {Promise<Array<{ date: string, heure: string, devise: string, impact: 'high'|'medium'|'low', titre: string, precedent: string, consigne: string }>>}
 */
async function getCalendar() {
  const now = Date.now();
  if (cache && (now - cacheTime) < CACHE_TTL_MS) return cache;

  try {
    const events = await scrapeForexFactory();
    cache = events;
    cacheTime = now;
    return events;
  } catch (e) {
    console.error('   Calendrier  : échec —', e.message);
    return cache || [];
  }
}

/**
 * Scrape le calendrier de Forex Factory.
 */
async function scrapeForexFactory() {
  const url = 'https://www.forexfactory.com/calendar?day=today';
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
 * Vérifie si une news à fort impact est imminente pour une devise donnée.
 *
 * @param {string} devise - Devise à vérifier (ex: 'EUR', 'USD')
 * @param {number} [fenetreMin] - Fenêtre en minutes avant la news (défaut: 30)
 * @returns {{ bloque: boolean, raison: string, news: object|null }}
 */
async function newsImminente(devise, fenetreMin = 30) {
  const events = await getCalendar();
  const now = new Date();
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  for (const ev of events) {
    if (ev.impact !== 'high') continue;
    if (!ev.devise.includes(devise.toUpperCase())) continue;

    // Parse l'heure de la news (format HH:MM)
    const [h, m] = ev.heure.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) continue;

    const newsMinutes = h * 60 + m;
    const diff = newsMinutes - nowMinutes;

    // News dans les prochaines X minutes ou vient de passer il y a moins de 5 min
    if (diff > 0 && diff <= fenetreMin) {
      return {
        bloque: true,
        raison: `News à fort impact dans ${diff} min : ${ev.titre}`,
        news: ev
      };
    }
  }

  return { bloque: false, raison: '', news: null };
}

/**
 * Filtre les signaux selon le calendrier économique.
 *
 * @param {string} symbol - Symbole (ex: 'EURUSD')
 * @returns {Promise<{ ok: boolean, detail: string, lecture: string }>}
 */
async function filtreCalendrier(symbol) {
  const devise = symbol ? symbol.slice(0, 3).toUpperCase() : '';
  if (!devise) return { ok: true, detail: 'devise inconnue', lecture: '' };

  const { bloque, raison } = await newsImminente(devise, 30);

  return {
    ok: !bloque,
    detail: raison || 'aucune news à fort impact',
    lecture: bloque
      ? `news à fort impact imminente — signal bloqué`
      : 'pas de news à fort impact dans les 30 prochaines minutes'
  };
}

/**
 * Vide le cache (forcer un rafraîchissement).
 */
function viderCache() {
  cache = null;
  cacheTime = 0;
}

module.exports = { getCalendar, newsImminente, filtreCalendrier, viderCache };
