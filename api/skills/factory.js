'use strict';
const fs = require('fs');
const path = require('path');
const { compile, ID } = require('./declarative');
const registry = require('./registry');
const ROOT = path.join(__dirname,'installed');
const NATIVE = new Set(['forex-session-monitor']);

// Legacy JS is never evaluated by the factory. Generated skills are JSON only.
async function eprouverSkillDansSandbox() {
  return { ok:false, erreurs:['JavaScript généré interdit ; utilisez une spécification JSON déclarative'] };
}
async function installerNouveauSkill({ id, specification, codeSource, tests = [] } = {}) {
  if (codeSource != null) return eprouverSkillDansSandbox();
  if (typeof id !== 'string' || !ID.test(id) || NATIVE.has(id)) return {ok:false, erreurs:['ID invalide ou réservé']};
  let skill;
  try {
    if (!specification || specification.id !== id) throw new Error('ID de spécification incohérent');
    const json = JSON.stringify(specification);
    if (Buffer.byteLength(json) > 32768) throw new Error('Spécification trop volumineuse');
    specification = JSON.parse(json);
    skill = compile(specification);
    if (!Array.isArray(tests) || !tests.length || tests.length > 30) throw new Error('1 à 30 tests fonctionnels requis');
    for (const t of tests) {
      const result = skill.executer(t.params || {});
      if (!t.attendu || typeof t.attendu !== 'object' || JSON.stringify(result) !== JSON.stringify(t.attendu)) throw new Error('Test fonctionnel non satisfait');
    }
  } catch(e) { return {ok:false, erreurs:[e.message]}; }
  const target = path.join(ROOT,id);
  let temp;
  try {
    fs.mkdirSync(ROOT,{recursive:true});
    if (fs.existsSync(target)) throw new Error('ID déjà installé');
    temp = fs.mkdtempSync(path.join(ROOT,'.draft-'));
    fs.writeFileSync(path.join(temp,'skill.json'),JSON.stringify(specification,null,2),{flag:'wx'});
    fs.writeFileSync(path.join(temp,'SKILL.md'),'# '+skill.nom+'\n\n'+skill.description+'\n',{flag:'wx'});
    fs.renameSync(temp,target);
    temp = null;
    registry.enregistrer(skill);
    registry.desactiver(id);
    return {ok:true,id,version:skill.version,nom:skill.nom,actif:false};
  } catch(e) { return {ok:false,erreurs:[e.message]}; }
  finally { if(temp) fs.rmSync(temp,{recursive:true,force:true}); }
}
function desinstallerSkill(id) {
  if (typeof id !== 'string' || !ID.test(id) || NATIVE.has(id)) return {ok:false,raison:'ID invalide ou réservé'};
  const target = path.join(ROOT,id);
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Dossier non autorisé');
    fs.rmSync(target,{recursive:true,force:true});
    registry.supprimer(id);
    return {ok:true,id};
  } catch(e) { return {ok:false,raison:e.message}; }
}
module.exports = {eprouverSkillDansSandbox,installerNouveauSkill,desinstallerSkill};
