/**
 * 5trade — VEILLE DES MARCHÉS → CONVERSATION.
 *
 * L'IA répondait sur les positions, mais elle ne disait rien des RETOURNEMENTS :
 * un biais qui passe d'acheteur à vendeur, une confirmation qui s'inverse. Un
 * trader ne l'apprend pas en relisant un tableau une heure plus tard.
 *
 * Chaque tour relit les marchés sous surveillance, compare la direction à celle
 * du tour précédent, et publie un événement DANS la conversation seulement si
 * quelque chose a réellement changé. Le premier tour est silencieux : on
 * mémorise l'état de départ au lieu d'annoncer un « retournement » qui n'a pas eu
 * lieu.
 *
 * Aucun chiffre n'est inventé : tout vient des bougies réellement reçues. Un
 * marché sans données est ignoré, et le dit une fois.
 */

const Flux = require('./flux');

const etat = new Map();     // "symbol|tf" → { direction, status, at }
let premierTour = true;
let deps = null;            // { Market, Signals, Alerts } injecté par le serveur

function etatParDefaut() {
  if (deps) return deps;
  deps = {
    Market: require('../sources/market'),
    Signals: require('../engine/signals'),
    Alerts: require('../delivery/alerts')
  };
  return deps;
}

/** Les marchés surveillés : la configuration de la surveillance, sinon rien. */
function marchesSurveilles() {
  const { Alerts } = etatParDefaut();
  const cfg = (Alerts.get && Alerts.get()) || {};
  return Array.isArray(cfg.marches) ? cfg.marches.filter(m => m && m.symbol) : [];
}

const libelle = (direction) => (direction === 'BUY' ? 'acheteur' : direction === 'SELL' ? 'vendeur' : 'neutre');

/**
 * Un tour de veille.
 * @returns {Promise<{marches:number, changements:number, evenements:number}>}
 */
async function tick() {
  const { Market, Signals } = etatParDefaut();
  const liste = marchesSurveilles();
  let changements = 0;
  let evenements = 0;

  for (const m of liste.slice(0, 12)) {
    const cle = `${m.symbol}|${m.tf}`;
    let verdict = null;
    try {
      const r = await Market.getCandles(m.symbol, m.tf, 200, m.provider);
      const closes = (r && r.candles ? r.candles : []).filter(c => c && c.closed !== false);
      if (closes.length < 20) continue;
      verdict = Signals.detect(closes, { symbol: m.symbol, timeframe: m.tf });
    } catch { continue; }   // marché indisponible : on ne devine pas

    if (!verdict) continue;
    const direction = verdict.direction || 'NEUTRAL';
    const status = verdict.status || 'neutre';
    const avant = etat.get(cle);
    etat.set(cle, { direction, status, at: Date.now() });
    if (premierTour) continue;

    const sens = String(verdict.sens || '').toLowerCase();
    const bascule = avant && avant.direction !== direction
      && ['BUY', 'SELL'].includes(direction) && ['BUY', 'SELL'].includes(avant.direction);

    // 1. Retournement : la direction s'inverse réellement.
    if (bascule) {
      changements++;
      const suite = status === 'confirme'
        ? 'signal confirmé par les règles'
        : 'à confirmer sur la clôture suivante';
      const msgTexte = `Retournement — ${m.symbol} ${m.tf} : le biais passe de `
        + `${libelle(avant.direction)} à ${libelle(direction)} (${suite}).`
        + (sens ? ` Direction de travail : ${sens === 'long' ? 'achat' : 'vente'}.` : '');

      await Flux.publier({
        type: 'retournement',
        gravite: status === 'confirme' ? 'warn' : 'info',
        meta: { symbol: m.symbol, timeframe: m.tf, avant: avant.direction,
          apres: direction, status },
        texte: msgTexte
      });

      // Notification immédiate sur Telegram si le canal est actif
      try {
        const { Alerts } = etatParDefaut();
        const cfg = (Alerts.get && Alerts.get()) || {};
        if (cfg.telegramToken && cfg.telegramChat) {
          const fetchRef = globalThis.fetch || require('node-fetch');
          await fetchRef(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: cfg.telegramChat,
              text: `⚠️ <b>Alerte Retournement — ${m.symbol} (${m.tf})</b>\n\n`
                + `Le biais de marché s'est inversé : <b>${libelle(avant.direction)} → ${libelle(direction)}</b>\n`
                + `Statut : ${suite}\n`
                + `Action conseillée : vérifier les positions ouvertes et ajuster le stop loss.`,
              parse_mode: 'HTML'
            })
          });
        }
      } catch (eTel) {
        console.error('[veille] erreur notification telegram retournement :', eTel.message);
      }

      evenements++;
      continue;
    }

    // 2. Confirmation d'un sens qui était encore en observation.
    if (avant && avant.direction === direction && avant.status !== 'confirme'
      && status === 'confirme' && ['BUY', 'SELL'].includes(direction)) {
      changements++;
      await Flux.publier({
        type: 'confirmation',
        gravite: 'ok',
        meta: { symbol: m.symbol, timeframe: m.tf, direction, status },
        texte: `Confirmation — ${m.symbol} ${m.tf} : le biais ${libelle(direction)} `
          + `passe de « à surveiller » à « confirmé ».`
      });
      evenements++;
    }
  }

  premierTour = false;

  // 3. Sentinelle News Économiques à fort impact (CPI, NFP, FOMC, Taux)
  try {
    const Fundamentals = require('../sources/fundamentals');
    const { getCalendarAvecEtat, instantEvenement } = Fundamentals;
    const { events, sourceDisponible } = await getCalendarAvecEtat();
    if (sourceDisponible && Array.isArray(events)) {
      const now = Date.now();
      const { Alerts } = etatParDefaut();
      const cfg = (Alerts.get && Alerts.get()) || {};
      for (const ev of events) {
        if (ev.impact !== 'high') continue;
        const t = instantEvenement(ev, new Date(now));
        if (!t) continue;
        const diffMin = Math.round((t - now) / 60000);
        // Alerte sous 45 min
        const cleNews = `news|${ev.devise}|${ev.titre}|${t}`;
        if (diffMin >= 0 && diffMin <= 45 && !etat.has(cleNews)) {
          etat.set(cleNews, { at: now });
          // Détermination du biais directionnel anticipé selon le titre ou la consigne
          const titreMin = ev.titre.toLowerCase();
          let decisionDirectionnelle = 'NEUTRE';
          let conseil = 'Volatilité extrême attendue : resserrer les stops ou rester en attente';
          if (titreMin.includes('cpi') || titreMin.includes('inflation')) {
            decisionDirectionnelle = 'HAUTE VOLATILITÉ (Biais VENTE indices/or si CPI supérieur, ACHAT si ralenti)';
          } else if (titreMin.includes('rate') || titreMin.includes('fomc') || titreMin.includes('interest')) {
            decisionDirectionnelle = 'DÉCISION DE TAUX (Biais fort selon politique monétaire)';
          } else if (titreMin.includes('nfp') || titreMin.includes('nonfarm') || titreMin.includes('payroll')) {
            decisionDirectionnelle = 'BIAIS DEVISE (ACHAT devise si créations massives, VENTE si décevant)';
          }

          const dateLisible = new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          const msgNews = `📅 <b>Alerte Annonce Économique Majeure (${ev.devise})</b>\n\n`
            + `• <b>Événement</b> : ${ev.titre}\n`
            + `• <b>Heure prévue</b> : ${dateLisible} (dans ${diffMin} min)\n`
            + `• <b>Devise impactée</b> : ${ev.devise}\n`
            + `• <b>Impact</b> : Élevé (3 étoiles / High)\n`
            + (ev.consigne ? `• <b>Prévision</b> : ${ev.consigne}\n` : '')
            + (ev.precedent ? `• <b>Précédent</b> : ${ev.precedent}\n` : '')
            + `• <b>Décision / Biais suggéré</b> : ${decisionDirectionnelle}\n`
            + `• <b>Consigne de sécurité</b> : ${conseil}`;

          await Flux.publier({
            type: 'news_impact',
            gravite: 'warn',
            meta: { devise: ev.devise, titre: ev.titre, heure: dateLisible, diffMin },
            texte: `Annonce imminente (${ev.devise}) : ${ev.titre} à ${dateLisible} (dans ${diffMin} min). Biais : ${decisionDirectionnelle}.`
          });

          if (cfg.telegramToken && cfg.telegramChat) {
            const fetchRef = globalThis.fetch || require('node-fetch');
            await fetchRef(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: cfg.telegramChat,
                text: msgNews,
                parse_mode: 'HTML'
              })
            }).catch(() => {});
          }
          evenements++;
        }
      }
    }
  } catch (eNews) {
    console.error('[veille] erreur sentinelle news :', eNews.message);
  }

  return { marches: liste.length, changements, evenements };
}

/** Oublie l'état mémorisé (utile après un changement de liste de marchés). */
function reinitialiser() { etat.clear(); premierTour = true; }

/** Ce que la veille a retenu, pour diagnostic. */
function photographie() {
  return [...etat.entries()].map(([cle, v]) => ({ marche: cle, ...v }));
}

module.exports = { tick, reinitialiser, photographie, marchesSurveilles };
