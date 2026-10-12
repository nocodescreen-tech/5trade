/**
 * Lexique personnalisé : les termes que l'utilisateur ajoute lui-même, en plus
 * de ceux que le moteur évalue déjà sur le graphique.
 *
 * Stockage JSON local : c'est de la configuration, pas des données métier — la
 * base n'apporterait rien ici.
 */
const fs = require('fs');
const path = require('path');

const DOSSIER = path.join(__dirname, '..', 'data');
const FICHIER = path.join(DOSSIER, 'lexique.json');
const FAMILLES = ['Structure', 'Zones', 'Prix', 'Flux', 'Risque', 'Moteur', 'Autre'];

function lire() {
  try {
    const j = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch { return []; }   // fichier absent = lexique complémentaire vide
}

function ecrire(liste) {
  fs.mkdirSync(DOSSIER, { recursive: true });
  fs.writeFileSync(FICHIER, JSON.stringify(liste, null, 2), 'utf8');
}

/**
 * Nettoie un terme reçu du client : on ne fait jamais confiance au contenu
 * envoyé. Le sigle doit rester court (c'est un sigle, pas une phrase).
 */
function normaliser(t = {}, idExistant = null) {
  const txt = (v, max) => String(v === undefined || v === null ? '' : v).trim().slice(0, max);
  const sigle = txt(t.sigle, 24);
  const nom = txt(t.nom, 80);
  if (!sigle) throw new Error('Le sigle est requis');
  if (!nom) throw new Error('Le nom complet est requis');
  return {
    id: idExistant || txt(t.id, 40) || 'lx_' + Date.now().toString(36),
    sigle,
    nom,
    fr: txt(t.fr, 60),
    famille: FAMILLES.includes(t.famille) ? t.famille : 'Autre',
    def: txt(t.def, 600),
    ou: txt(t.ou, 200),
    perso: true,
    maj: new Date().toISOString()
  };
}

function lister() { return lire(); }

function ajouter(t) {
  const liste = lire();
  const terme = normaliser(t);
  // Un sigle déjà présent serait ambigu dans l'interface : on refuse.
  if (liste.some(x => x.sigle.toLowerCase() === terme.sigle.toLowerCase())) {
    throw new Error(`Le terme « ${terme.sigle} » existe déjà`);
  }
  liste.push(terme);
  ecrire(liste);
  return terme;
}

function modifier(id, t) {
  const liste = lire();
  const i = liste.findIndex(x => x.id === id);
  if (i < 0) throw new Error('Terme introuvable');
  const terme = normaliser({ ...liste[i], ...t }, id);
  liste[i] = terme;
  ecrire(liste);
  return terme;
}

function supprimer(id) {
  const liste = lire();
  const apres = liste.filter(x => x.id !== id);
  if (apres.length === liste.length) throw new Error('Terme introuvable');
  ecrire(apres);
  return { supprime: id };
}

module.exports = { lister, ajouter, modifier, supprimer, FAMILLES };
