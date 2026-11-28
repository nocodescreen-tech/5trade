'use strict';
const crypto = require('node:crypto');
const Fund = require('../sources/fundamentals');
const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function planifier(events, actifs, maintenant = Date.now()) {
  if (!Number.isFinite(maintenant)) return [];
  const out = new Map();
  for (const ev of events || []) {
    if (ev.impact !== 'high' || typeof ev.titre !== 'string' || !ev.titre.trim()) continue;
    const at = ev.horodatageSource;
    if (!Number.isFinite(at) || at <= 0) continue;
    const delta = (at - maintenant) / 60000;
    const phase = delta > 0 && delta <= 30 ? 'avant' : delta <= 0 && delta >= -15 ? 'apres' : null;
    if (!phase) continue;
    const devise = String(ev.devise || '').toUpperCase();
    const symbols = [...new Set((actifs || []).filter(a => a?.actif !== false && Fund.devisesDuSymbole(a.symbol).devises.includes(devise)).map(a=>a.symbol))];
    if (!symbols.length) continue;
    const key = 'macro_' + crypto.createHash('sha256').update(JSON.stringify([devise,ev.titre.trim().toLowerCase(),at,phase])).digest('hex').slice(0,32);
    const heure = new Date(at).toLocaleString('fr-FR',{timeZone:'Africa/Kinshasa',dateStyle:'short',timeStyle:'short',hourCycle:'h23'});
    const texte = [
      '<b>'+(phase==='avant'?'ANNONCE ÉCONOMIQUE IMMINENTE':'FENÊTRE POST-ANNONCE')+'</b>',
      esc(devise)+' — '+esc(ev.titre),
      'Heure : '+esc(heure)+' (Kinshasa, UTC+1)',
      'Marchés sélectionnés : '+esc(symbols.join(', ')),
      'Impact : élevé. Fenêtre de prudence : 30 min avant / 15 min après.',
      'Source : '+esc(ev.source || 'calendrier économique'),
      phase==='apres' && ev.reel != null && ev.reel !== '' ? 'Publié : '+esc(ev.reel) : null,
      'La direction du marché et la reprise des cotations ne sont pas confirmées.'
    ].filter(Boolean).join('\n');
    out.set(key,{key,texte,phase,at,devise});
  }
  return [...out.values()].sort((a,b)=>a.at-b.at);
}
async function notifier(config, deps = {}) {
  if (!config?.telegramToken || !config?.telegramChat) return {envoyes:0};
  const flux = await (deps.calendrier || Fund.getCalendarAvecEtat)();
  if (!flux.sourceDisponible) return {envoyes:0,verifie:false};
  const actifs = (deps.actifs || require('../core/instruments-actifs').obtenirActifs)();
  const tracker = deps.tracker || require('./notification-tracker');
  let envoyes = 0;
  for (const item of planifier(flux.events,actifs,deps.now ?? Date.now()).slice(0,12)) {
    if (tracker.estDejaEnvoye(item.key)) continue;
    const result = await tracker.envoyerTelegramSecurise(config.telegramToken,config.telegramChat,item.texte);
    if (result.ok) {
      tracker.marquerEnvoye(item.key,{type:'macro',phase:item.phase,eventAt:item.at,messageId:result.messageId});
      envoyes++;
    }
  }
  return {envoyes,verifie:true};
}
module.exports = {planifier,notifier};
