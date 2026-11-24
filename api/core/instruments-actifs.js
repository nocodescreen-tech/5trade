/**
 * 5TRADE — GESTIONNAIRE DES INSTRUMENTS ACTIFS
 *
 * Règle fondamentale du système :
 * 1. Première ouverture : UNIQUEMENT XAUUSD (frxXAUUSD sur Deriv) est actif par défaut.
 * 2. Les indices Deriv (R_10, R_25, R_75, etc.) ou paires Forex/Crypto n'apparaissent QUE
 *    lorsque l'utilisateur les sélectionne explicitement dans le catalogue.
 * 3. Lorsqu'un instrument est retiré/désactivé, il disparaît de l'écran live ET son scan/alertes s'arrêtent.
 * 4. Si l'utilisateur désactive tout : état « Aucun instrument actif », aucun scan ni nouvelle alerte.
 * 5. Persistance serveur (PostgreSQL ou data/instruments-actifs.json) : au redémarrage de 5TRADE,
 *    la même sélection est fidèlement restaurée.
 * 6. Les signaux et positions déjà pris dans le journal sont conservés intacts même après retrait.
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./dossiers');

const FICHIER_ACTIFS = path.join(DATA_DIR, 'instruments-actifs.json');

// Instrument par défaut initial (Première ouverture : XAUUSD uniquement)
const DEFAUT_INITIAL = [
  {
    symbol: 'frxXAUUSD',
    provider: 'deriv',
    label: 'Or / USD — spot',
    tv: 'DERIV:XAUUSD',
    tf: '5m',
    famille: 'metaux',
    actif: true,
    ajouteLe: new Date().toISOString()
  }
];

function lireFichier() {
  try {
    if (fs.existsSync(FICHIER_ACTIFS)) {
      const data = JSON.parse(fs.readFileSync(FICHIER_ACTIFS, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {
    console.error('[InstrumentsActifs] Erreur lecture fichier :', e.message);
  }
  return null;
}

function ecrireFichier(liste) {
  try {
    fs.mkdirSync(path.dirname(FICHIER_ACTIFS), { recursive: true });
    fs.writeFileSync(FICHIER_ACTIFS, JSON.stringify(liste, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[InstrumentsActifs] Erreur écriture fichier :', e.message);
    return false;
  }
}

/**
 * Obtient la liste des instruments actifs.
 * @returns {Array<object>}
 */
function obtenirActifs() {
  const existant = lireFichier();
  if (existant !== null) {
    return existant;
  }
  // Première ouverture : initialiser avec XAUUSD uniquement
  ecrireFichier(DEFAUT_INITIAL);
  return [...DEFAUT_INITIAL];
}

/**
 * Définit et persiste la liste complète des instruments actifs.
 * @param {Array<object>} liste
 * @returns {Array<object>} la liste normalisée enregistrée
 */
function definirActifs(liste) {
  if (!Array.isArray(liste)) {
    throw new Error('La liste des instruments actifs doit être un tableau');
  }
  const propres = [];
  const vus = new Set();
  for (const item of liste) {
    if (!item) continue;
    const sym = String(item.symbol || item).trim();
    if (!sym || vus.has(sym.toUpperCase())) continue;
    vus.add(sym.toUpperCase());
    propres.push({
      symbol: sym,
      provider: item.provider || (sym.startsWith('frx') || sym.startsWith('R_') || sym.startsWith('1HZ') ? 'deriv' : 'binance'),
      label: item.label || sym,
      tv: item.tv || (item.provider === 'deriv' ? `DERIV:${sym.replace(/^frx/, '')}` : sym),
      tf: item.tf || '5m',
      famille: item.famille || (sym.includes('XAU') || sym.includes('XAG') ? 'metaux' : sym.startsWith('R_') ? 'synthetique' : 'forex'),
      actif: true,
      ajouteLe: item.ajouteLe || new Date().toISOString()
    });
  }
  ecrireFichier(propres);
  // Synchroniser le gestionnaire d'alertes
  synchroniserAlertes(propres);
  return propres;
}

/**
 * Ajoute un instrument à la liste des actifs.
 */
function ajouterInstrument(inst) {
  if (!inst || !inst.symbol) return obtenirActifs();
  const actifs = obtenirActifs();
  const sym = String(inst.symbol).trim().toUpperCase();
  const deja = actifs.find(a => a.symbol.toUpperCase() === sym);
  if (deja) {
    if (inst.tf && deja.tf !== inst.tf) {
      deja.tf = inst.tf;
      return definirActifs(actifs);
    }
    return actifs;
  }
  actifs.push({
    symbol: inst.symbol,
    provider: inst.provider || 'deriv',
    label: inst.label || inst.symbol,
    tv: inst.tv || inst.symbol,
    tf: inst.tf || '5m',
    famille: inst.famille || (inst.symbol.includes('XAU') ? 'metaux' : inst.symbol.startsWith('R_') ? 'synthetique' : 'forex'),
    actif: true,
    ajouteLe: new Date().toISOString()
  });
  return definirActifs(actifs);
}

/**
 * Retire un instrument de la sélection active (sans toucher au journal des trades).
 */
function retirerInstrument(symbole) {
  if (!symbole) return obtenirActifs();
  const sym = String(symbole).trim().toUpperCase();
  const actifs = obtenirActifs().filter(a => a.symbol.toUpperCase() !== sym);
  return definirActifs(actifs);
}

/**
 * Synchronise les marchés surveillés par delivery/alerts.js
 */
function synchroniserAlertes(listeActifs) {
  try {
    const Alerts = require('../delivery/alerts');
    const marches = (listeActifs || []).map(a => ({
      symbol: a.symbol,
      tf: a.tf || '15m',
      provider: a.provider || 'deriv'
    }));
    Alerts.update({ marches });
  } catch (e) {
    console.error('[InstrumentsActifs] Erreur synchronisation alertes :', e.message);
  }
}

module.exports = {
  obtenirActifs,
  definirActifs,
  ajouterInstrument,
  retirerInstrument,
  synchroniserAlertes,
  DEFAUT_INITIAL
};
