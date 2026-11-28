'use strict';
const Registry = require('../../skills/registry');
const Factory = require('../../skills/factory');
const { ID } = require('../../skills/declarative');

async function lister() {
  const skills = Registry.lister();
  return { texte: skills.length ? skills.map(s => s.id + ' — ' + s.nom + ' (v' + s.version + ', ' + (s.actif ? 'actif' : 'inactif') + ') : ' + s.description).join('\n') : 'Aucune compétence enregistrée.' };
}

async function creer(sujet, ctx) {
  if (!ctx.confirmed || !ctx.utilisateur) return { erreur:'Confirmation authentifiée requise' };
  if (typeof ctx.ia !== 'function') return { erreur:'Modèle IA indisponible' };
  if (typeof sujet !== 'string' || sujet.length < 8 || sujet.length > 2000) return { erreur:'Décrivez le calcul demandé (8 à 2000 caractères)' };
  try {
    const raw = await ctx.ia([
      {role:'system',content:'Produis uniquement un objet JSON {specification,tests}. specification: {id,nom,version:"1.0.0",description,actions:[nomAction],outputs:{nomAction:{nomSortie:expression}}}. Expression: nombre fini, {input:"nom"}, ou {op:"add|sub|mul|div|min|max|abs",args:[expressions]} (2 arguments sauf abs). Tests: 3 à 10 objets {params:{action,entrées numériques},attendu:{sorties numériques}}. Aucun JavaScript, réseau, accès fichiers, ordre, modification du risque ou donnée secrète. Si le besoin ne peut pas être exprimé avec ces opérations, retourne {"erreur":"motif"}. Les tests générés ne prouvent pas la validité financière. La compétence restera inactive.'},
      {role:'user',content:sujet}
    ],{maxTokens:2400,route:'chat'});
    const propre = String(raw || '').trim().replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,'');
    if (Buffer.byteLength(propre) > 45000) throw new Error('Réponse trop volumineuse');
    const draft = JSON.parse(propre);
    if (draft.erreur) return {erreur:'Besoin non pris en charge par les compétences numériques'};
    const spec = draft.specification;
    if (!spec || !Array.isArray(draft.tests) || draft.tests.length < 3 || draft.tests.length > 10) throw new Error('Spécification ou tests incomplets');
    const result = await Factory.installerNouveauSkill({id:spec.id,specification:spec,tests:draft.tests});
    if (!result.ok) return {erreur:result.erreurs.join(' ; ')};
    return {texte:'Compétence '+result.id+' installée, inactive. '+spec.nom+' — '+spec.description+'\nFormules : '+JSON.stringify(spec.outputs)+'\nTests générés réussis : '+draft.tests.length+' (à vérifier indépendamment).\nPour activer après contrôle : active skill '+result.id, skillId:result.id, actif:false};
  } catch(e) { return {erreur:'Création refusée : '+e.message}; }
}

function changer(actif) {
  return async (id,ctx) => {
    if (!ctx.confirmed || !ctx.utilisateur) return {erreur:'Confirmation authentifiée requise'};
    if (!ID.test(id)) return {erreur:'Identifiant invalide'};
    Registry.lister();
    const r = actif ? Registry.activer(id) : Registry.desactiver(id);
    return r.ok ? {texte:'Compétence '+id+(actif?' activée.':' désactivée.')} : {erreur:r.raison};
  };
}

async function calculer(sujet) {
  const m = sujet.match(/^([a-z0-9_-]{3,50})\s+(\{[\s\S]*\})$/);
  if (!m || sujet.length > 4000) return {erreur:'Format : calcule skill ID {"action":"nom","a":1}'};
  const skill = Registry.obtenir(m[1]);
  if (!skill?.declaratif) return {erreur:'Seules les compétences déclaratives peuvent être calculées ici'};
  try {
    const params = JSON.parse(m[2]);
    const r = await Registry.executer(m[1],params,{});
    return r.ok ? {texte:'Résultat : '+JSON.stringify(r.resultat)} : {erreur:r.raison};
  } catch(e) { return {erreur:e.message}; }
}
module.exports = {lister,creer,activer:changer(true),desactiver:changer(false),calculer};
