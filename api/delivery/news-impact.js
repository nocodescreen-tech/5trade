/**
 * Impact directionnel des dépêches.
 *
 * Chaque news reçoit un SENS exploitable (ACHAT / VENTE / NEUTRE) pour les
 * actifs qu'elle concerne, avec une raison courte. L'analyse passe par la
 * fonction IA injectée par le serveur (chaîne NVIDIA NIM en cascade), jamais par
 * un appel direct : un modèle en panne ne doit pas vider la page News.
 *
 * Deux garde-fous :
 *  - CACHE DISQUE par empreinte du titre : une dépêche n'est analysée qu'UNE
 *    fois. Sans lui, chaque ouverture de l'onglet relançait un appel par article.
 *  - Aucune invention : si le modèle ne répond pas ou rend un JSON inutilisable,
 *    on ne retourne rien pour ces articles (l'écran dit « non interprété »).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('../core/dossiers');
const { extraireJSON } = require('../core/json-ia');

const FICHIER = path.join(process.env.NEWS_IMPACT_FICHIER || path.join(DATA_DIR, 'news-impact.json'));
const TTL_MS = Number(process.env.NEWS_IMPACT_TTL_H || 168) * 3600000; // 7 jours
const MAX_ARTICLES = 12;   // par appel : borne les tokens et le temps de réponse

const SENS = new Set(['ACHAT', 'VENTE', 'NEUTRE']);

/** Titre normalisé : clé de rapprochement lisible côté interface. */
const titreNorm = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Empreinte stable d'une dépêche : titre normalisé + source. */
function cle(a) {
  const base = `${titreNorm(a.titre)}|${a.sourceId || a.source || ''}`;
  return crypto.createHash('sha1').update(base).digest('hex').slice(0, 16);
}

function charger() {
  try { return JSON.parse(fs.readFileSync(FICHIER, 'utf-8')); }
  catch { return {}; }
}

function ecrire(map) {
  try {
    fs.mkdirSync(path.dirname(FICHIER), { recursive: true });
    const tmp = `${FICHIER}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(map));
    fs.renameSync(tmp, FICHIER);   // écriture atomique : jamais de JSON tronqué
  } catch { /* le cache ne doit jamais bloquer la page */ }
}

/** Cache utilisable (non périmé), indexé par empreinte. */
function lire() {
  const brut = charger();
  const maintenant = Date.now();
  const out = {};
  for (const [k, v] of Object.entries(brut)) {
    if (!v || (maintenant - Number(v.at || 0)) > TTL_MS) continue;
    out[k] = v;
  }
  return out;
}

const PROMPT = `Tu es analyste de marché. Pour chaque dépêche, donne son IMPACT DIRECTIONNEL
sur les actifs concernés.

Définitions strictes :
- ACHAT  : la nouvelle rend l'actif plus probable à la hausse (assouplissement, adoption,
           demande, résultats meilleurs que prévu, baisse de taux pour un actif risqué).
- VENTE  : la nouvelle rend l'actif plus probable à la baisse (durcissement, hack, enquête
           réglementaire, défaut, résultats décevants, hausse de taux).
- NEUTRE : aucun effet directionnel défendable, ou news purement informative.
N'invente pas : dans le doute, réponds NEUTRE.

Réponds EXCLUSIVEMENT par un objet JSON de la forme :
{"impacts":[{"i":0,"sens":"ACHAT","actifs":["BTC"],"raison":"court texte (max 120 caractères)","force":0.6}]}
- "i" reprend l'indice fourni.
- "force" entre 0 et 1 = solidité de la lecture, PAS une probabilité de gain.`;

function promptPour(lot) {
  const lignes = lot.map((a, i) =>
    `[${i}] source=${a.source || '?'} | actifs=${(a.actifs || []).join(',') || 'non précisé'}\n` +
    `titre: ${a.titre}\n` +
    (a.resume ? `résumé: ${String(a.resume).slice(0, 260)}\n` : '')
  ).join('\n');
  return `${PROMPT}\n\nDÉPÊCHES :\n${lignes}`;
}

/** Valide une entrée de réponse et la normalise ; null si inutilisable. */
function normaliser(entree, article) {
  if (!entree || typeof entree !== 'object') return null;
  const sens = String(entree.sens || '').toUpperCase();
  if (!SENS.has(sens)) return null;
  const force = Number(entree.force);
  return {
    sens,
    actifs: Array.isArray(entree.actifs) && entree.actifs.length
      ? entree.actifs.map(x => String(x).slice(0, 12)).slice(0, 4)
      : (article.actifs || []).slice(0, 4),
    raison: String(entree.raison || '').replace(/\s+/g, ' ').slice(0, 140) || null,
    force: Number.isFinite(force) ? Math.max(0, Math.min(1, +force.toFixed(2))) : null
  };
}

/**
 * Analyse les dépêches qui ne sont pas déjà en cache.
 * @param {Array} articles  dépêches {titre, resume, source, sourceId, actifs}
 * @param {Function} ia     appellée comme ia(messages, {maxTokens, json, route})
 * @returns {Promise<Object>} map empreinte → impact (cache inclus)
 */
async function analyser(articles, ia) {
  const cache = lire();
  const liste = (Array.isArray(articles) ? articles : []).filter(a => a && a.titre);

  // On ne redemande QUE ce qui manque, dans la limite d'un lot.
  const aFaire = liste.filter(a => !cache[cle(a)]).slice(0, MAX_ARTICLES);
  const sortie = { ...cache };
  if (!aFaire.length || typeof ia !== 'function') return sortie;

  let brut;
  try {
    brut = await ia([{ role: 'user', content: promptPour(aFaire) }],
      { maxTokens: 900, json: true, route: 'news-impact' });
  } catch (e) {
    // Panne IA : on rend le cache existant. La page reste utilisable.
    return sortie;
  }

  let data;
  try { data = JSON.parse(extraireJSON(brut)); } catch { return sortie; }
  const impacts = Array.isArray(data) ? data : (data && data.impacts);
  if (!Array.isArray(impacts)) return sortie;

  const maintenant = Date.now();
  for (const entree of impacts) {
    const i = Number(entree && entree.i);
    if (!Number.isInteger(i) || !aFaire[i]) continue;
    const art = aFaire[i];
    const val = normaliser(entree, art);
    if (!val) continue;                       // sens inconnu = on n'écrit rien
    sortie[cle(art)] = {
      ...val, at: maintenant,
      titre: art.titre.slice(0, 160),
      titreNorm: titreNorm(art.titre)      // rapprochement direct côté interface
    };
  }
  ecrire(sortie);
  return sortie;
}

/** Impacts indexés par titre normalisé — ce que consomme l'onglet News. */
function parTitre() {
  const out = {};
  for (const v of Object.values(lire())) {
    if (v && v.titreNorm) out[v.titreNorm] = v;
  }
  return out;
}

module.exports = { analyser, lire, parTitre, cle, normaliser, titreNorm, FICHIER, MAX_ARTICLES };
