'use strict';
// A generated skill is data, never JavaScript. Only bounded numeric operations.
const ID = /^[a-z0-9_-]{3,50}$/;
const KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,49}$/;
const OPS = new Set(['add','sub','mul','div','min','max','abs']);
function compile(spec) {
  if (!spec || typeof spec !== 'object' || typeof spec.id !== 'string' || !ID.test(spec.id) ||
      typeof spec.nom !== 'string' || spec.nom.length < 3 || spec.nom.length > 100 ||
      typeof spec.description !== 'string' || spec.description.length < 10 || spec.description.length > 1000 ||
      typeof spec.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(spec.version) ||
      !Array.isArray(spec.actions) || !spec.actions.length || spec.actions.length > 10 ||
      !spec.outputs || typeof spec.outputs !== 'object' || Array.isArray(spec.outputs)) throw new Error('Spécification déclarative invalide');
  const actions = [...new Set(spec.actions)];
  if (actions.some(a => typeof a !== 'string' || !KEY.test(a))) throw new Error('Action invalide');
  let count = 0;
  function expression(node, depth = 0) {
    if (++count > 200 || depth > 12) throw new Error('Expression trop complexe');
    if (typeof node === 'number' && Number.isFinite(node)) return () => node;
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('Expression invalide');
    if (typeof node.input === 'string' && KEY.test(node.input) && Object.keys(node).length === 1) {
      const key = node.input;
      return p => {
        if (!Object.hasOwn(p,key) || typeof p[key] !== 'number' || !Number.isFinite(p[key])) throw new Error('Entrée numérique requise : ' + key);
        return p[key];
      };
    }
    if (!OPS.has(node.op) || !Array.isArray(node.args) || node.args.length !== (node.op === 'abs' ? 1 : 2)) throw new Error('Opération invalide');
    const args = node.args.map(n => expression(n,depth+1));
    const op = node.op;
    return p => {
      const [a,b] = args.map(fn => fn(p));
      let r;
      switch(op) {
        case 'add': r=a+b; break; case 'sub': r=a-b; break; case 'mul': r=a*b; break;
        case 'div': if(b===0) throw new Error('Division par zéro'); r=a/b; break;
        case 'min': r=Math.min(a,b); break; case 'max': r=Math.max(a,b); break; case 'abs': r=Math.abs(a); break;
      }
      if (!Number.isFinite(r)) throw new Error('Résultat non fini');
      return r;
    };
  }
  const handlers = new Map();
  for (const action of actions) {
    if (!Object.hasOwn(spec.outputs,action)) throw new Error('Sorties manquantes');
    const out = spec.outputs[action];
    if (!out || typeof out !== 'object' || Array.isArray(out) || Object.keys(out).length < 1 || Object.keys(out).length > 20) throw new Error('Sorties invalides');
    const fields = Object.entries(out).map(([key,node]) => {
      if (!KEY.test(key) || ['constructor','prototype','__proto__'].includes(key)) throw new Error('Nom de sortie interdit');
      return [key,expression(node)];
    });
    handlers.set(action,fields);
  }
  return { id:spec.id, nom:spec.nom, version:spec.version, description:spec.description, actions, actif:false, declaratif:true,
    executer(params = {}) {
      const fields = handlers.get(params.action || actions[0]);
      if (!fields) throw new Error('Action non disponible');
      return Object.fromEntries(fields.map(([key,fn])=>[key,fn(params)]));
    }
  };
}
module.exports = { compile, ID };
