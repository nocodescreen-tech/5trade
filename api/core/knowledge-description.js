'use strict';

// A strategy is executable configuration, not prose. Never repair truncated
// output or silently replace missing rules with the motor's default rules.
function validerFicheDescription(raw) {
  if (typeof raw !== 'string') throw new Error('Réponse IA non textuelle');
  const texte = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let f;
  try { f = JSON.parse(texte); } catch { throw new Error('JSON de stratégie invalide'); }
  const invalide = () => { throw new Error('Fiche de stratégie incomplète ou invalide'); };
  if (!f || typeof f !== 'object' || Array.isArray(f)) invalide();
  const nonVide = s => typeof s === 'string' && s.trim().length > 0;
  for (const k of ['titre', 'resume', 'entree']) if (!nonVide(f[k])) invalide();
  for (const k of ['invalidation', 'objectif', 'contexte']) {
    if (!Object.hasOwn(f, k) || (f[k] !== null && !nonVide(f[k]))) invalide();
  }
  if (!Array.isArray(f.regles) || !f.regles.length || f.regles.some(r => !['R1','R2','R3','R4'].includes(r))) invalide();
  if (!Array.isArray(f.filtres) || f.filtres.some(r => !['volatilite','session','range','structure'].includes(r))) invalide();
  if (![null,'scalping','intraday','swing'].includes(f.style)) invalide();
  if (!Array.isArray(f.timeframes) || f.timeframes.some(t => typeof t !== 'string' || !/^\d+[mhd]$/.test(t))) invalide();
  for (const k of ['concepts','motsCles']) if (!Array.isArray(f[k]) || f[k].some(t => !nonVide(t))) invalide();
  if (f.seuilAlignes != null && (!Number.isInteger(f.seuilAlignes) || f.seuilAlignes < 1)) invalide();
  if (f.seuilForce != null && (!Number.isFinite(f.seuilForce) || f.seuilForce < 0 || f.seuilForce > 1)) invalide();
  return JSON.stringify(f);
}
module.exports = { validerFicheDescription };
