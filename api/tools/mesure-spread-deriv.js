/**
 * MESURE DU SPREAD RÉEL CHEZ DERIV — ask − bid, sur cotations vivantes.
 *
 * Pourquoi mesurer au lieu de chercher un chiffre : un spread « 0,5 pip » lu sur
 * une page marketing n'est pas le spread de l'instrument qu'on trade. Deriv
 * publie ses cotations ; ask − bid EST le coût d'entrée, par définition.
 *
 * Ce que le script fait : se connecte à l'API publique, prend N cotations par
 * symbole, retient la MÉDIANE (pas la moyenne : quelques pics de news
 * gonfleraient le résultat) et propose une entrée pour data/frais.json.
 *
 * Il n'écrit RIEN tout seul : sortir les valeurs, c'est décider de les appliquer.
 *
 * Usage : node tools/mesure-spread-deriv.js [SYMBOLE ...]
 *         (défaut : les symboles réellement présents dans le journal)
 */
const WebSocket = require('ws');

const APP_ID = Number(process.env.DERIV_APP_ID) || 1089;
// Endpoint qui fonctionne réellement (celui de api/sources/market.js) :
// `ws.derivws.com/websockets/v3` répond 520 au handshake depuis cette machine.
const URL = process.env.DERIV_WS_URL || 'wss://api.derivws.com/trading/v1/options/ws/public';
const N = Number(process.env.SPREAD_ECHANTILLONS) || 25;

if (typeof fetch !== 'function') { console.error('Node 18+ requis'); process.exit(1); }

/** Demande générique : une requête, une réponse, puis on ferme. */
function demander(ws, payload) {
  return new Promise((resolve, reject) => {
    const id = payload.req_id || String(Math.random()).slice(2);
    const timer = setTimeout(() => reject(new Error('délai dépassé')), 15000);
    const onMsg = raw => {
      let m;
      try { m = JSON.parse(raw); } catch { return; }
      if (m.req_id !== id) return;
      clearTimeout(timer);
      ws.off('message', onMsg);
      if (m.error) return reject(new Error(m.error.message));
      resolve(m);
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ ...payload, req_id: id }));
  });
}

/** Médiane d'une liste de nombres. */
const mediane = l => {
  const s = [...l].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function mesurer(symboles) {
  const ws = new WebSocket(URL);
  await new Promise((ok, ko) => { ws.once('open', ok); ws.once('error', ko); });

  const resultats = {};
  for (const sym of symboles) {
    try {
      // pip_size officiel : c'est lui qui convertit un spread en « pips ».
      const info = await demander(ws, {
        active_symbols: 'brief', product_type: 'basic'
      }).catch(() => null);
      const fiche = info && (info.active_symbols || []).find(s => s.underlying_symbol === sym);

      const mesures = [];
      await new Promise((resolve) => {
        const id = 'sub' + Math.random().toString(36).slice(2);
        const timer = setTimeout(resolve, 20000);
        const onMsg = raw => {
          let m;
          try { m = JSON.parse(raw); } catch { return; }
          if (m.msg_type !== 'tick' || !m.tick || m.tick.symbol !== sym) return;
          const { ask, bid } = m.tick;
          if (Number.isFinite(ask) && Number.isFinite(bid) && ask > bid) mesures.push(ask - bid);
          if (mesures.length >= N) {
            clearTimeout(timer);
            ws.send(JSON.stringify({ forget_all: 'ticks' }));
            ws.off('message', onMsg);
            resolve();
          }
        };
        ws.on('message', onMsg);
        ws.send(JSON.stringify({ ticks: sym, subscribe: 1, req_id: id }));
      });
      ws.send(JSON.stringify({ forget_all: 'ticks' }));

      if (!mesures.length) { resultats[sym] = { erreur: 'aucune cotation reçue' }; continue; }
      const med = mediane(mesures);
      const pip = fiche ? Number(fiche.pip_size) : null;
      resultats[sym] = {
        cotations: mesures.length,
        spreadMedian: +med.toFixed(6),
        spreadMin: +Math.min(...mesures).toFixed(6),
        spreadMax: +Math.max(...mesures).toFixed(6),
        pipSize: pip,
        enPips: pip ? +(med / pip).toFixed(2) : null,
        nom: fiche ? fiche.display_name : null
      };
    } catch (e) { resultats[sym] = { erreur: e.message.slice(0, 80) }; }
  }
  ws.close();
  return resultats;
}

(async () => {
  const args = process.argv.slice(2);
  const defaut = ['frxXAUUSD', 'R_75', 'R_25', 'R_10', 'R_100', 'cryBTCUSD', 'cryETHUSD'];
  const symboles = args.length ? args : defaut;
  console.log(`Mesure du spread Deriv (${N} cotations par symbole)…\n`);
  const r = await mesurer(symboles);
  for (const [sym, v] of Object.entries(r)) {
    if (v.erreur) { console.log(`  ${sym.padEnd(12)} ERREUR : ${v.erreur}`); continue; }
    console.log(`  ${sym.padEnd(12)} ${String(v.nom || '').slice(0, 22).padEnd(23)} `
      + `médiane ${String(v.spreadMedian).padStart(10)} (${v.enPips} pip) · `
      + `min ${v.spreadMin} · max ${v.spreadMax} · ${v.cotations} cotations`);
  }
  console.log('\nÀ reporter dans data/frais.json → parSymbole[symbole].spread (unités de prix, pas de pips).');
  process.exit(0);
})().catch(e => { console.error('ERREUR:', e.message.slice(0, 160)); process.exit(1); });
