/**
 * Routes d'alertes — premier domaine extrait de server.js.
 *
 * Patron retenu pour le découpage progressif (le reste suivra domaine par
 * domaine) : chaque fichier de routes exporte une fonction qui reçoit l'app et
 * ses dépendances. Aucune variable globale, aucun require circulaire.
 *
 *   require('./routes/alerts')(app, { requireAuth, Alerts, sendMail, DB })
 */
module.exports = function monterAlertes(app, deps) {
  const { requireAuth, Alerts, sendMail, DB, Audit, ia } = deps;
  const MASK='••••••••';
  const safeConfig=c=>({...c,telegramToken:c.telegramToken?MASK:null,telegramConfigured:!!c.telegramToken});

  /**
   * Alertes : prévenir HORS de la page quand un signal se confirme.
   * L'utilisateur ne peut pas rester devant l'onglet : sans ça, un signal
   * confirmé passe inaperçu.
   */
  app.get('/api/alerts', requireAuth, (req, res) => {
    const c = Alerts.get();
    res.json({ success: true, config: safeConfig(c), historique: c.derniers || [] });
  });

  /**
   * « Pourquoi je ne reçois rien ? » — la question qui coûte le plus de temps.
   * On énumère ce qui manque au lieu de laisser deviner.
   * Le jeton n'est jamais renvoyé, seulement sa présence.
   */
  app.get('/api/alerts/diagnostic', requireAuth, (req, res) => {
    res.json({ success: true, ...Alerts.diagnostic() });
  });

  app.put('/api/alerts', requireAuth, (req, res) => {
    try {
      const patch={...(req.body||{})};
      if(patch.telegramToken===MASK)delete patch.telegramToken;
      const c = Alerts.update(patch);
      Alerts.start();                    // applique tout de suite le nouvel intervalle
      // Changement de configuration = action sensible : elle décide de ce qui sera
      // envoyé et à qui. On trace QUI l'a fait et ce qui a changé, sans jamais
      // recopier le jeton Telegram ni l'adresse email en clair.
      if (deps.Audit) {
        deps.Audit.enregistrer({
          acteur: (req.session && req.session.user) || 'anonyme',
          action: 'alertes.config', cible: 'surveillance', ip: req.ip,
          detail: {
            actif: c.actif === true,
            marches: Array.isArray(c.marches) ? c.marches.length : 0,
            strategies: Array.isArray(c.strategies) ? c.strategies.length : 0,
            intervalleSec: Math.round((c.intervalleMs || 0) / 1000),
            telegram: !!c.telegramToken,
            email: !!c.email
          }
        }).catch(() => {});
      }
      res.json({ success: true, config: safeConfig(c) });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  /** Contrôle immédiat, sans attendre le prochain cycle. */
  app.post('/api/alerts/verifier', requireAuth, async (req, res) => {
    try {
      const r = await Alerts.verifier(true);
      res.json({ success: true, ...r });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /**
   * Trouve l'identifiant de la conversation Telegram.
   *
   * L'utilisateur n'a qu'à écrire à son bot : on lit getUpdates et on renvoie la
   * conversation qui vient de lui parler. Sans cela il devrait pêcher cet
   * identifiant à la main dans une URL d'API — ce que personne ne fait.
   */
  app.post('/api/alerts/telegram/trouver', requireAuth, async (req, res) => {
    try {
      const supplied=req.body?.token;
      const jeton=String(supplied && supplied!==MASK ? supplied : Alerts.get().telegramToken || '').trim();
      if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(jeton)) return res.status(400).json({ error: 'Donne d\'abord le jeton du bot (donné par BotFather).' });

      const r = await fetch(`https://api.telegram.org/bot${jeton}/getUpdates?timeout=0`, {
        signal: AbortSignal.timeout(10000) // 10s max
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) {
        return res.status(400).json({
          error: 'Telegram refuse ce jeton. Vérifie qu’il est complet et sans espace.'
        });
      }

      const chats = [];
      for (const maj of (d.result || [])) {
        const msg = maj.message || maj.edited_message || maj.channel_post;
        if (msg && msg.chat && !chats.some(x => String(x.id) === String(msg.chat.id))) {
          chats.push({
            id: msg.chat.id,
            nom: msg.chat.title || [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ')
              || (msg.chat.username ? '@' + msg.chat.username : '') || 'conversation'
          });
        }
      }
      if (!chats.length) {
        return res.json({
          success: true, trouve: false,
          aide: 'Aucune conversation pour l\'instant. Ouvre Telegram, cherche ton bot, envoie-lui « salut », puis clique à nouveau.'
        });
      }
      res.json({ success: true, trouve: true, chats });
    } catch (e) {
      res.status(500).json({ error: 'Impossible de joindre Telegram' });
    }
  });

  /** Test d'envoi : vérifie que les canaux configurés fonctionnent vraiment. */
  app.post('/api/alerts/test', requireAuth, async (req, res) => {
    try {
      const c = Alerts.get();
      const canal = String((req.body && req.body.canal) || 'email');

      // Telegram : un vrai message. Un jeton valide ne prouve rien — il faut que le
      // message arrive sur le téléphone.
      if (canal === 'telegram') {
        if (!c.telegramToken) return res.status(400).json({ error: 'Jeton du bot manquant.' });
        if (!c.telegramChat) {
          return res.status(400).json({ error: 'Conversation manquante : clique d\'abord sur « Trouver ma conversation ».' });
        }
        const r = await fetch(`https://api.telegram.org/bot${c.telegramToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: c.telegramChat,
            text: '<b>5trade — test</b>\n\nSi tu lis ce message, les alertes Telegram '
              + 'fonctionnent. Tu recevras ici chaque signal confirmé, une seule fois par signal.',
            parse_mode: 'HTML',
            disable_web_page_preview: true
          }),
          signal: AbortSignal.timeout(15000) // 15s max
        });
        const d = await r.json().catch(() => ({}));
        if (!d.ok) {
          return res.status(400).json({
            error: `Telegram refuse l'envoi (${d.description || 'HTTP ' + r.status}). `
              + 'Vérifie le jeton et la conversation.'
          });
        }
        return res.json({ success: true, canal: 'telegram',
          message: 'Message envoyé : regarde ton téléphone.' });
      }

      // Email : le destinataire vient de la configuration, sinon du compte en base.
      // L'ancien code lisait une variable `account` qui n'existait pas dans cette
      // portée : le test par email échouait en 500 « account is not defined ».
      const compte = await DB.getAccount();
      const to = c.email || (compte && compte.email);
      if (!to) return res.status(400).json({ error: 'Aucun destinataire : renseigne une adresse email' });
      await sendMail({
        to,
        subject: '[5trade] Test d\'alerte',
        html: `<div style="font-family:system-ui,sans-serif;background:#0b1017;color:#e2e8f0;padding:20px;border-radius:12px">
          <h2 style="margin:0 0 8px;color:#34d399">Alertes opérationnelles</h2>
          <p style="color:#94a3b8;font-size:13.5px;margin:0">
            Ce message confirme que 5trade peut te prévenir par email quand un signal
            se confirme sur les marchés surveillés. Aucune action requise.</p></div>`
      });
      res.json({ success: true, to });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // The secret is set when registering the webhook with Telegram. Private
  // chat ownership is required in addition to the shared webhook secret.
  app.post('/api/alerts/telegram/webhook', async (req, res) => {
    const { authorizeUpdate } = require('../delivery/telegram-auth');
    const { sendOnce } = require('../delivery/telegram-outbox');
    const c = Alerts.get();
    const update = req.body || {};
    const authorization = authorizeUpdate(update, req.get('X-Telegram-Bot-Api-Secret-Token'), process.env.TELEGRAM_WEBHOOK_SECRET, c.telegramChat);
    if (!authorization.ok) return res.status(authorization.status).json({ ok: false });
    if (!c.telegramToken) return res.status(503).json({ ok: false });
    const chat = authorization.chatId;
    try {
      const cb = update.callback_query;
      if (cb) {
        let message = 'Action indisponible. Le journal et les ordres restent distincts.';
        if (cb.data === 'recap:refresh' || cb.data === 'account:status') {
          const briefing = await genererBriefingTelegram(c, { DB });
          const result = await sendOnce(c.telegramToken, chat, briefing.texte,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: briefing.inline_keyboard } });
          message = result.ok ? 'Récapitulatif transmis' : 'Envoi non confirmé';
        }
        await fetch('https://api.telegram.org/bot' + c.telegramToken + '/answerCallbackQuery', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({callback_query_id: cb.id, text: message}),
          signal: AbortSignal.timeout(8000)
        }).catch(() => {});
      } else if (typeof update.message?.text === 'string') {
        const text = update.message.text.trim();
        // No mutating chat commands until persistent replay protection and
        // channel-bound authorization exist.
        if (/^\/(recap|briefing|matin|journal|resume|start)(?:@\w+)?(?:\s|$)/i.test(text)) {
          const briefing = await genererBriefingTelegram(c, { DB });
          await sendOnce(c.telegramToken, chat, briefing.texte,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: briefing.inline_keyboard } });
        } else {
          await sendOnce(c.telegramToken, chat,
            'Commandes disponibles : /recap, /briefing. Les modifications de compte et de journal passent par le terminal authentifié.',
            {parse_mode: 'HTML'});
        }
      }
      return res.json({ ok: true });
    } catch (error) {
      console.error('[Telegram webhook] traitement indisponible');
      return res.status(503).json({ ok: false });
    }
  });

  /**
   * Consultation du récapitulatif / briefing du jour pour l'affichage écran
   */
  app.get('/api/recap/du-jour', requireAuth, async (req, res) => {
    try {
      const c = Alerts.get();
      const briefing = await genererBriefingTelegram(c, { DB });
      res.json({
        success: true,
        texte: briefing.texte,
        date: new Date().toISOString(),
        telegramConfigure: Boolean(c && c.telegramToken && c.telegramChat)
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /**
   * Envoi immédiat du récapitulatif sur Telegram depuis l'interface
   */
  app.post('/api/recap/envoyer-telegram', requireAuth, async (req, res) => {
    try {
      const c = Alerts.get();
      if (!c.telegramToken || !c.telegramChat) {
        return res.status(400).json({ success: false, error: 'Telegram non configuré (jeton ou chat_id manquant)' });
      }
      const briefing = await genererBriefingTelegram(c, { DB });
      const NotificationTracker = require('../delivery/notification-tracker');
      const envoi = await NotificationsendOnce(
        c.telegramToken,
        c.telegramChat,
        briefing.texte,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: briefing.inline_keyboard } }
      );
      if (!envoi.ok) {
        return res.status(400).json({ success: false, error: envoi.erreur });
      }
      res.json({ success: true, message: 'Briefing envoyé avec succès sur Telegram !' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /**
   * Déclenchement manuel ou planifié du briefing matinal Telegram
   */
  app.post('/api/alerts/telegram/briefing', requireAuth, async (req, res) => {
    try {
      const c = Alerts.get();
      if (!c.telegramToken || !c.telegramChat) {
        return res.status(400).json({ success: false, error: 'Telegram non configuré (jeton ou chat_id manquant)' });
      }
      const briefing = await genererBriefingTelegram(c, { DB });
      const result = await require('../delivery/notification-tracker').envoyerTelegramSecurise(
        c.telegramToken, c.telegramChat, briefing.texte,
        {parse_mode:'HTML', reply_markup:{inline_keyboard:briefing.inline_keyboard}});
      return res.status(result.ok ? 200 : 502).json({success:result.ok, envoye:result.ok, messageId:result.messageId || null});
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
};

/**
 * Génère le contenu complet du briefing matinal avec statistiques réelles du journal et du compte
 */
function escapeTelegram(value) { return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
async function genererBriefingTelegram(c, depsRef = {}) {
  const Risque = require('../risk/risque');
  const JournalSignaux = require('../engine/journal-signaux');
  const cfgRisque = Risque.configuration();
  const capital = cfgRisque.capital || 1000;
  const risqueMax = cfgRisque.risquePct || 1;

  const dbRef = depsRef.DB;
  let openTrades = [];
  try {
    if (dbRef && typeof dbRef.listTrades === 'function') {
      const list = await dbRef.listTrades();
      openTrades = (list || []).filter(t => t.status === 'open');
    }
  } catch {}

  let statsJournal = { gagnes: 0, perdus: 0, total: 0, rTotal: 0 };
  try {
    const st = JournalSignaux.stats();
    if (st) {
      statsJournal.gagnes = st.nbGagnants ?? st.gagnants ?? 0;
      statsJournal.perdus = st.nbPerdants ?? 0;
      statsJournal.total = st.clos ?? st.total ?? 0;
      statsJournal.rTotal = Number(st.rNet ?? st.rTotal ?? 0);
    }
  } catch {}

  const d = new Date();
  const dateStr = d.toLocaleDateString('fr-FR', { timeZone:'Africa/Kinshasa', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const heureStr = d.toLocaleTimeString('fr-FR', { timeZone:'Africa/Kinshasa', hour: '2-digit', minute: '2-digit' });
  const marches = Array.isArray(c.marches) && c.marches.length
    ? c.marches.map(m => typeof m === 'object' ? (m.symbol || m.symbole) : m).join(', ')
    : 'Forex, Synthétiques, Métaux';

  const rSigne = statsJournal.rTotal >= 0 ? `+${statsJournal.rTotal.toFixed(2)}` : statsJournal.rTotal.toFixed(2);
  const pnlEmoji = statsJournal.rTotal >= 0 ? '📈' : '📉';

  const texte = `☀️ <b>Briefing Matinal & Récapitulatif 5trade</b>\n`
    + `📅 <i>${dateStr} (${heureStr})</i>\n\n`
    + `💼 <b>Positions en cours</b> : <b>${openTrades.length}</b> ouverte(s)\n`
    + (openTrades.length ? openTrades.map(t => `   • <code>${escapeTelegram(t.pair || t.symbol)}</code> (${escapeTelegram(t.direction)}) — Entrée: ${escapeTelegram(t.entry)} | SL: ${escapeTelegram(t.sl)}`).join('\n') + '\n' : '   • Aucune position active — Capital 100% disponible\n')
    + `\n📊 <b>Bilan du Journal Récent</b> :\n`
    + `   • Prises clôturées : <b>${statsJournal.total}</b> (✅ ${statsJournal.gagnes} W / ❌ ${statsJournal.perdus} L)\n`
    + `   • Performance nette cumulée : ${pnlEmoji} <b>${rSigne} R</b>\n\n`
    + `🛡️ <b>Gestion du Risque</b> :\n`
    + `   • Capital de référence : <b>$${capital.toLocaleString('fr-FR')}</b>\n`
    + `   • Risque max/trade : <b>${risqueMax}%</b> ($${((capital * risqueMax) / 100).toFixed(2)})\n`
    + `   • Filtres Sentinelle & RR ≥ 1.5 : <b>Actifs</b>\n\n`
    + `🎯 <b>Marchés Surveillés</b> : <code>${escapeTelegram(marches)}</code>\n\n`
    + `<i>Tapez /recap pour consulter le briefing. Modifications depuis le terminal authentifié.</i>`;

  const inline_keyboard = [
    [
      { text: '📊 Statut Compte', callback_data: 'account:status' },
      { text: '🔄 Actualiser Récap', callback_data: 'recap:refresh' }
    ]
  ];

  return { texte, inline_keyboard };
}

module.exports.genererBriefingTelegram = genererBriefingTelegram;
