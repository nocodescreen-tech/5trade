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
  // SEPT groupes pour sept variables. La version précédente n'en capturait que
  // SIX (l'impact n'était pas capturé) alors que la destructuration en attendait
  // sept : tout était décalé d'un cran, `impact` recevait le TITRE, et
  // `previous` valait `undefined` — donc `.trim()` levait à chaque événement et
  // le calendrier ne renvoyait jamais rien. Un filtre économique qui échoue en
  // silence est pire qu'aucun filtre : on croit être protégé.
  const regex = /calendar__date[^>]*>([^<]+)[\s\S]*?calendar__time[^>]*>([^<]+)[\s\S]*?calendar__currency[^>]*>([^<]+)[\s\S]*?calendar__impact[^>]*>([\s\S]*?)<\/td>[\s\S]*?calendar__title[^>]*>([^<]+)[\s\S]*?calendar__forecast[^>]*>([^<]*)[\s\S]*?calendar__previous[^>]*>([^<]*)/g;

  let match;
  while ((match = regex.exec(html)) !== null) {
    const [, date, heure, devise, impactHtml, titre, forecast, previous] = match;
    const brut = String(impactHtml || '');
    const impactLevel = /high|ff-impact-red|icon--ff-impact-red/i.test(brut) ? 'high'
      : /medium|ff-impact-ora|orange|icon--ff-impact-ora/i.test(brut) ? 'medium' : 'low';

    events.push({
      date: String(date || '').trim(),
      heure: String(heure || '').trim(),
      devise: String(devise || '').trim().toUpperCase(),
      impact: impactLevel,
      titre: String(titre || '').trim(),
      precedent: String(previous || '').trim(),
      consigne: String(forecast || '').trim()
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
const MOIS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * Instant UTC d'un événement, à partir de sa date (« Nov 12 ») et de son heure
 * (« 8:30am »). Renvoie null si l'un des deux est illisible — « All Day »,
 * « Tentative » — au lieu de deviner.
 *
 * Pourquoi c'est nécessaire : la version précédente ne comparait QUE l'heure.
 * Un événement du lendemain à 8:30 bloquait donc la paire aujourd'hui à 8:30,
 * et un événement d'hier bloquait encore. Près de minuit, le filtre bloquait
 * au hasard.
 */
function instantEvenement(ev, reference = new Date()) {
  const d = String((ev && ev.date) || '').trim().toLowerCase();
  const h = String((ev && ev.heure) || '').trim().toLowerCase();
  const md = d.match(/^([a-z]{3})[a-z]*\s+(\d{1,2})$/);
  const mh = h.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
  if (!md || !mh) return null;
  const mois = MOIS[md[1]];
  if (mois === undefined) return null;

  let heures = Number(mh[1]);
  const minutes = Number(mh[2]);
  const suffixe = mh[3];
  if (suffixe === 'pm' && heures < 12) heures += 12;
  if (suffixe === 'am' && heures === 12) heures = 0;
  if (heures > 23 || minutes > 59) return null;

  const annee = reference.getUTCFullYear();
  let t = Date.UTC(annee, mois, Number(md[2]), heures, minutes);
  // Passage d'année : un événement de décembre lu en janvier appartient à
  // l'année précédente, et inversement.
  const ecart = t - reference.getTime();
  if (ecart < -180 * 86400000) t = Date.UTC(annee + 1, mois, Number(md[2]), heures, minutes);
  else if (ecart > 180 * 86400000) t = Date.UTC(annee - 1, mois, Number(md[2]), heures, minutes);
  return t;
}

/**
 * Verdict économique POUR UNE DEVISE : fonction pure, donc testable sans réseau.
 * @returns {{bloque:boolean, raison?:string, news?:object, verifie:boolean}}
 */
function verdictDevise(events, devise, { maintenant = new Date(), fenetreMin = 30 } = {}) {
  const code = String(devise || '').toUpperCase();
  if (!code) return { bloque: false, verifie: true, raison: 'devise inconnue' };
  const now = maintenant.getTime();

  for (const ev of events || []) {
    if (ev.impact !== 'high') continue;
    const concernes = String(ev.devise || '').toUpperCase().split(/[^A-Z]+/).filter(Boolean);
    if (!concernes.includes(code)) continue;

    const t = instantEvenement(ev, maintenant);
    if (t === null) continue;            // heure inconnue : on ne conclut pas

    const diff = Math.round((t - now) / 60000);
    if (diff >= -5 && diff <= fenetreMin) {
      return {
        bloque: true, verifie: true, news: ev,
        raison: diff >= 0
          ? `News à fort impact dans ${diff} min : ${ev.titre}`
          : `News à fort impact publiée il y a ${-diff} min : ${ev.titre}`
      };
    }
  }
  return { bloque: false, verifie: true, raison: 'aucune annonce à fort impact dans la fenêtre' };
}

async function newsImminente(devise, fenetreMin = 30) {
  const { events, sourceDisponible } = await getCalendarAvecEtat();
  if (!sourceDisponible) {
    return { bloque: false, raison: 'calendrier indisponible : filtre non vérifié', news: null, verifie: false };
  }
  return verdictDevise(events, devise, { maintenant: new Date(), fenetreMin });

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

module.exports = {
  verdictDevise, instantEvenement, getCalendar, getCalendarAvecEtat, newsImminente, filtreCalendrier, devisesDuSymbole, viderCache };
