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
  const { requireAuth, Alerts, sendMail, DB } = deps;

  /**
   * Alertes : prévenir HORS de la page quand un signal se confirme.
   * L'utilisateur ne peut pas rester devant l'onglet : sans ça, un signal
   * confirmé passe inaperçu.
   */
  app.get('/api/alerts', requireAuth, (req, res) => {
    const c = Alerts.get();
    res.json({ success: true, config: c, historique: c.derniers || [] });
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
      const c = Alerts.update(req.body || {});
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
      res.json({ success: true, config: c });
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
      const jeton = String((req.body && req.body.token) || Alerts.get().telegramToken || '').trim();
      if (!jeton) return res.status(400).json({ error: 'Donne d\'abord le jeton du bot (donné par BotFather).' });

      const r = await fetch(`https://api.telegram.org/bot${jeton}/getUpdates?timeout=0`, {
        signal: AbortSignal.timeout(10000) // 10s max
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) {
        return res.status(400).json({
          error: `Telegram refuse ce jeton (${d.description || 'HTTP ' + r.status}). Vérifie qu'il est complet et sans espace.`
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
      res.status(500).json({ error: `Impossible de joindre Telegram : ${e.message}` });
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
};
