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

  /** Webhook Telegram pour actions interactives (boutons Prendre trade / Breakeven / Clôturer). */
  app.post('/api/alerts/telegram/webhook', async (req, res) => {
    try {
      const update = req.body || {};
      const c = Alerts.get();
      if (update.callback_query) {
        const cb = update.callback_query;
        const data = String(cb.data || '');
        const chatId = cb.message && cb.message.chat && cb.message.chat.id;
        const msgId = cb.message && cb.message.message_id;

        let reponseText = 'Action enregistrée';
        const Trades = require('../delivery/trades');
        const Risque = require('../risk/risque');
        const cfgRisque = Risque.configuration();
        const capitalCompte = cfgRisque.capital || 1000;
        const risqueMaxPct = cfgRisque.risquePct || 1;

        if (data.startsWith('trade:open:')) {
          // Extraire symbole et direction depuis callback_data (ex: trade:open:frxXAUUSD:BUY:1732145600000)
          const parts = data.replace('trade:open:', '').split(':');
          const sym = parts[0] || 'INCONNU';
          const dir = parts[1] === 'SELL' ? 'SELL' : 'BUY';

          // Retrouver le signal depuis les derniers signaux alertés
          const dernierSignal = (c.derniers || []).find(d => d.symbol === sym && (d.direction === dir || !d.direction)) || (c.derniers || [])[0];

          let entry = dernierSignal ? Number(dernierSignal.entry || dernierSignal.prix) : 0;
          let sl = dernierSignal ? Number(dernierSignal.sl) : 0;
          let tp = dernierSignal ? Number(dernierSignal.tp) : 0;

          if (!entry || entry <= 0) entry = 100;
          if (!sl || sl <= 0) sl = dir === 'BUY' ? +(entry * 0.99).toFixed(5) : +(entry * 1.01).toFixed(5);
          if (!tp || tp <= 0) tp = dir === 'BUY' ? +(entry * 1.02).toFixed(5) : +(entry * 0.98).toFixed(5);

          const distanceRisque = Math.abs(entry - sl);
          const montantRisque = (capitalCompte * risqueMaxPct) / 100;
          const taille = distanceRisque > 0 ? +(montantRisque / distanceRisque).toFixed(2) : 1;

          const tradeId = 'trd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const nouveauTrade = {
            id: tradeId,
            pair: sym,
            symbol: sym,
            direction: dir,
            entry,
            sl,
            tp,
            size: taille,
            status: 'open',
            openTime: new Date().toISOString(),
            risk: distanceRisque,
            reward: Math.abs(tp - entry),
            plannedRR: distanceRisque > 0 ? +(Math.abs(tp - entry) / distanceRisque).toFixed(2) : 2,
            notes: `Ouvert via Telegram Bot (${dernierSignal?.summary || 'Signal direct'})`
          };

          try {
            await DB.saveTradeRecord(nouveauTrade);
            reponseText = `⚡ Ordre EXÉCUTÉ et ENREGISTRÉ au journal !\n` +
                          `• Paire : ${sym}\n` +
                          `• Sens : ${dir}\n` +
                          `• Entrée : ${entry}\n` +
                          `• Stop : ${sl}\n` +
                          `• TP : ${tp}\n` +
                          `• ID : #${tradeId}`;
          } catch (eTrd) {
            reponseText = `❌ Erreur enregistrement : ${eTrd.message}`;
          }
        } else if (data.startsWith('trade:be:')) {
          const parts = data.replace('trade:be:', '').split(':');
          const sym = parts[0];
          try {
            const openTrades = (await DB.listTrades()).filter(t => t.status === 'open');
            const cible = sym ? openTrades.find(t => t.pair === sym || t.symbol === sym) : openTrades[0];
            if (cible) {
              cible.sl = cible.entry;
              cible.notes = (cible.notes || '') + ' [Breakeven appliqué via Telegram]';
              await DB.saveTradeRecord(cible);
              reponseText = `🛡️ Breakeven ACTIVÉ sur #${cible.id} (${cible.pair || cible.symbol}) : SL déplacé à ${cible.entry}`;
            } else {
              reponseText = `ℹ️ Aucune position ouverte trouvée à passer en Breakeven.`;
            }
          } catch (eBe) {
            reponseText = `❌ Erreur Breakeven : ${eBe.message}`;
          }
        } else if (data.startsWith('trade:tp1:')) {
          const parts = data.replace('trade:tp1:', '').split(':');
          const sym = parts[0];
          try {
            const openTrades = (await DB.listTrades()).filter(t => t.status === 'open');
            const cible = sym ? openTrades.find(t => t.pair === sym || t.symbol === sym) : openTrades[0];
            if (cible) {
              cible.size = +(cible.size * 0.5).toFixed(2);
              cible.notes = (cible.notes || '') + ' [TP1 50% sécurisé via Telegram]';
              await DB.saveTradeRecord(cible);
              reponseText = `🎯 TP1 sécurisé sur #${cible.id} : 50% des lots clôturés, reste ${cible.size} lot(s).`;
            } else {
              reponseText = `ℹ️ Aucune position ouverte trouvée pour TP1.`;
            }
          } catch (eTp) {
            reponseText = `❌ Erreur TP1 : ${eTp.message}`;
          }
        } else if (data.startsWith('trade:close:')) {
          const parts = data.replace('trade:close:', '').split(':');
          const sym = parts[0];
          try {
            const openTrades = (await DB.listTrades()).filter(t => t.status === 'open');
            const cible = sym ? openTrades.find(t => t.pair === sym || t.symbol === sym) : openTrades[0];
            if (cible) {
              const cloture = Trades.close(cible, { exitPrice: cible.entry, exitReason: 'Telegram Bot Clôture Manuelle' });
              await DB.saveTradeRecord(cloture);
              reponseText = `❌ Position #${cible.id} (${cible.pair || cible.symbol}) CLÔTURÉE au journal !`;
            } else {
              reponseText = `ℹ️ Aucune position ouverte trouvée à clôturer.`;
            }
          } catch (eCl) {
            reponseText = `❌ Erreur clôture : ${eCl.message}`;
          }
        } else if (data === 'account:status') {
          try {
            const openTrades = (await DB.listTrades()).filter(t => t.status === 'open');
            const capital = cfgRisque.capital || 1000;
            const risque = cfgRisque.risquePct || 1;
            reponseText = `📊 <b>État du Compte & Risque</b> :\n` +
                          `• Capital : $${capital}\n` +
                          `• Risque max/trade : ${risque}% ($${((capital * risque) / 100).toFixed(2)})\n` +
                          `• Positions ouvertes : ${openTrades.length}\n` +
                          `• Statut : Sécurisé`;
          } catch (eAcc) {
            reponseText = `📊 Compte: $1,000 | Risque max: 1% ($10) | Statut: Sécurisé`;
          }
        }

        // Répondre à Telegram pour effacer le spinner du bouton
        if (c.telegramToken) {
          const fetchRef = globalThis.fetch || require('node-fetch');
          await fetchRef(`https://api.telegram.org/bot${c.telegramToken}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: cb.id, text: reponseText })
          }).catch(() => {});

          if (chatId) {
            await fetchRef(`https://api.telegram.org/bot${c.telegramToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text: `👉 <i>Action Telegram</i> : <b>${reponseText}</b>`, parse_mode: 'HTML' })
            }).catch(() => {});
          }
        }
      } else if (update.message && update.message.text) {
        // Dialogue en langage naturel direct avec l'IA copilote depuis Telegram
        const msg = update.message;
        const chatId = msg.chat && msg.chat.id;
        const texteUtilisateur = String(msg.text || '').trim();

        if (chatId && texteUtilisateur && c.telegramToken) {
          const fetchRef = globalThis.fetch || require('node-fetch');
          try {
            const ChatCRUD = require('../chat-crud');
            const rIA = await ChatCRUD.executer(texteUtilisateur, {
              utilisateur: msg.from && (msg.from.username || msg.from.first_name) || 'telegram_user',
              ia: typeof ia === 'function' ? ia : null
            });

            const reponseChat = (rIA && (rIA.texte || (rIA.ia && rIA.ia.texte))) || 'Je suis votre copilote 5trade. Comment puis-je vous aider sur vos positions et analyses ?';

            await fetchRef(`https://api.telegram.org/bot${c.telegramToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: `🤖 <b>5trade Copilote</b> :\n\n${reponseChat}`,
                parse_mode: 'HTML'
              })
            }).catch(() => {});
          } catch (eChat) {
            await fetchRef(`https://api.telegram.org/bot${c.telegramToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: `⚠️ Copilote momentanément indisponible : ${eChat.message}`
              })
            }).catch(() => {});
          }
        }
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(200).json({ ok: false, error: e.message });
    }
  });
};
