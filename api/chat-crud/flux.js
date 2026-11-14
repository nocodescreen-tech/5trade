/**
 * 5trade — FLUX D'ÉVÉNEMENTS → CONVERSATION.
 *
 * Pourquoi ce fichier existe : l'IA répondait quand on lui parlait, mais elle
 * ignorait ce qui venait de se passer. Un stop touché, un TP1 atteint, un
 * scénario expiré : l'utilisateur devait aller le chercher dans un tableau.
 *
 * Ici chaque événement réel du système est PUBLIÉ dans la conversation comme un
 * message de l'assistant (bulle), et conservé en mémoire pour servir de contexte
 * au prochain échange. Rien n'est inventé : un message n'est écrit que si un
 * module a réellement constaté le fait (journal des signaux, scénarios).
 */

const MAX_MEMOIRE = 80;
const recents = [];   // { at, type, gravite, texte, meta }

const heure = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Prix lisible : les gros nombres n'ont pas besoin de 6 décimales. */
const prix = (x) => (Number.isFinite(Number(x))
  ? (Math.abs(Number(x)) >= 1000 ? Number(x).toFixed(2) : Number(x).toFixed(5))
  : '—');
const rLisible = (r) => (Number.isFinite(Number(r))
  ? `${Number(r) > 0 ? '+' : ''}${Number(r).toFixed(2)} R` : 'R inconnu');

/**
 * Publie un événement : bulle dans la conversation + mémoire pour le contexte.
 * @param {{type:string, texte:string, gravite?:'ok'|'bad'|'warn'|'info', meta?:object}} ev
 */
async function publier(ev) {
  if (!ev || !ev.texte) return null;
  const evenement = {
    at: Date.now(),
    type: ev.type || 'info',
    gravite: ev.gravite || 'info',
    texte: String(ev.texte),
    meta: ev.meta || null
  };
  recents.push(evenement);
  if (recents.length > MAX_MEMOIRE) recents.shift();

  // La bulle est écrite dans l'historique du chat : elle survit au rechargement,
  // comme un message normal, et se relit au prochain démarrage.
  try {
    const H = require('./historique');
    await H.enregistrer({
      role: 'assistant',
      texte: evenement.texte,
      verbe: 'ÉVÉNEMENT',
      sujet: evenement.type,
      action: evenement.meta ? { ...evenement.meta, gravite: evenement.gravite, type: evenement.type } : { gravite: evenement.gravite, type: evenement.type }
    });
  } catch (e) {
    console.error('flux : écriture de l’événement impossible —', e.message);
  }
  return evenement;
}

/** Les N derniers événements, du plus ancien au plus récent. */
function lister(n = 20) {
  return recents.slice(-Math.max(1, n));
}

/** Bloc texte pour le prompt : ce qui vient de se passer, en clair. */
function resume(n = 8) {
  const liste = lister(n);
  if (!liste.length) return '';
  return liste.map(e => `[${heure(e.at)}] ${e.texte}`).join('\n');
}

/**
 * Compose le message d'issue d'une position — fonction PURE, sans écriture.
 * Séparée de la publication pour être vérifiable sans polluer la conversation.
 * @returns {{type:string, gravite:string, texte:string, meta:object}|null}
 */
function composerIssue(sig, avant) {
  if (!sig || sig.resultat === avant) return null;
  const sens = String(sig.sens || '').toLowerCase() === 'long' ? 'achat' : 'vente';
  const tete = `${sig.symbol || '?'} ${sig.timeframe || ''}`.trim();
  const base = { symbol: sig.symbol, timeframe: sig.timeframe, sens: sig.sens,
    entree: sig.entree, stop: sig.stop, objectifs: sig.objectifs,
    resultat: sig.resultat, r: sig.r };

  if (sig.resultat === 'sl') {
    return { type: 'issue', gravite: 'bad', meta: base,
      texte: `Stop touché — ${tete} ${sens} : position close à ${rLisible(sig.r)} `
        + `(entrée ${prix(sig.entree)}, stop ${prix(sig.stop)}). Le scénario est invalidé.` };
  }
  if (sig.resultat === 'be') {
    return { type: 'issue', gravite: 'warn', meta: base,
      texte: `Retour à l’entrée — ${tete} ${sens} : ${rLisible(sig.r)}. TP1 avait été pris, `
        + `le stop à l’entrée a protégé la position.` };
  }
  if (sig.resultat === 'tp1') {
    return { type: 'objectif', gravite: 'ok', meta: base,
      texte: `TP1 atteint — ${tete} ${sens} : ${rLisible(sig.r)}. `
        + `Ferme 50 % et place le stop à l’entrée (${prix(sig.entree)}).` };
  }
  if (sig.resultat === 'tp2') {
    return { type: 'objectif', gravite: 'ok', meta: base,
      texte: `TP2 atteint — ${tete} ${sens} : ${rLisible(sig.r)}. `
        + `Ferme 30 % et laisse courir le reste sous un trailing de 1,5 ATR.` };
  }
  if (sig.resultat === 'expire') {
    return { type: 'expiration', gravite: 'warn', meta: base,
      texte: `Suivi terminé — ${tete} ${sens} : ${rLisible(sig.r)}, objectif non atteint `
        + `dans la fenêtre suivie. La position sort du suivi.` };
  }
  return null;
}

/** Publie l'issue d'une position du journal (une seule fois par transition). */
async function issuePosition(sig, avant) {
  const ev = composerIssue(sig, avant);
  return ev ? publier(ev) : null;
}

/** Compose le message d'un scénario (pure) — expiration ou déclenchement. */
function composerScenario(scn, quoi) {
  if (!scn) return null;
  const sens = String(scn.direction || '').toLowerCase() === 'long' ? 'achat' : 'vente';
  const tete = `${scn.instrument || '?'} ${scn.timeframe || ''}`.trim();
  const base = { scenarioId: scn.id, instrument: scn.instrument,
    direction: scn.direction, niveauEntree: scn.niveauEntree, quoi };
  if (quoi === 'expire') {
    return { type: 'scenario', gravite: 'warn', meta: base,
      texte: `Scénario expiré — ${tete} ${sens} : le prix n’a pas atteint `
        + `${prix(scn.niveauEntree)} dans la fenêtre. Le plan est retiré.` };
  }
  if (quoi === 'declenche') {
    return { type: 'scenario', gravite: 'ok', meta: base,
      texte: `Scénario déclenché — ${tete} ${sens} : le prix a atteint `
        + `${prix(scn.niveauEntree)}. Vérifie la confirmation M5 avant d’entrer.` };
  }
  return null;
}

/** Publie l'issue d'un scénario. */
async function issueScenario(scn, quoi) {
  const ev = composerScenario(scn, quoi);
  return ev ? publier(ev) : null;
}

module.exports = { publier, lister, resume, issuePosition, issueScenario,
  composerIssue, composerScenario, MAX_MEMOIRE };
