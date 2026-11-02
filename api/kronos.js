/**
 * 5trade — client Kronos (prévision de bougies K-line).
 *
 * Kronos est un modèle PyTorch (NeoQuasar) : il ne peut pas tourner dans le
 * processus Node, et encore moins sur l'allocation gratuite de l'hébergeur
 * (0,5 vCPU / 1 Gio). Il vit donc dans un service Python séparé (kronos-service),
 * interrogé en HTTP.
 *
 * Règle de conduite, la même que pour le secours IA : ce client ne doit JAMAIS
 * faire échouer une analyse. Service absent, lent, ou en erreur → on renvoie
 * `null` et l'app continue sans prévision. Un modèle de recherche n'est pas une
 * dépendance dure.
 *
 *   KRONOS_URL=http://127.0.0.1:8077      (vide = désactivé)
 *   KRONOS_ACTIF=false                    (coupe-circuit explicite)
 *   KRONOS_TIMEOUT_MS=20000
 */
const URL_BASE = (process.env.KRONOS_URL || '').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.KRONOS_TIMEOUT_MS || 20000);
const ACTIF = String(process.env.KRONOS_ACTIF || 'true') !== 'false';

const configure = () => ACTIF && URL_BASE.length > 0;

/** État du service : sert au diagnostic, jamais à bloquer une analyse. */
async function sante() {
  if (!ACTIF) return { ok: false, raison: 'désactivé (KRONOS_ACTIF=false)' };
  if (!URL_BASE) return { ok: false, raison: 'non configuré (KRONOS_URL vide)' };
  try {
    const r = await fetch(`${URL_BASE}/sante`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return { ok: false, raison: `HTTP ${r.status}` };
    return await r.json();
  } catch (e) {
    return { ok: false, raison: e.message };
  }
}

/**
 * Prévision à partir de bougies {t,o,h,l,c,v}.
 * @returns {Promise<null|{biais,variation_pct,amplitude_pct,prix,latence_ms,modele}>}
 */
async function prevoir(bougies, { predLen = 12, sampleCount = 1, topP = 0.9 } = {}) {
  if (!configure()) return null;
  if (!Array.isArray(bougies) || bougies.length < 32) return null;
  try {
    const r = await fetch(`${URL_BASE}/prevoir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bougies, pred_len: predLen, sample_count: sampleCount, top_p: topP }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d && Array.isArray(d.prix) && d.prix.length ? d : null;
  } catch {
    return null;   // service éteint, lent ou en erreur : l'analyse continue sans lui
  }
}

/** Résumé d'une ligne, pour l'injecter dans un prompt d'analyse. */
function resume(prevision) {
  if (!prevision) return null;
  return {
    modele: prevision.modele,
    biais: prevision.biais,
    variation_pct: prevision.variation_pct,
    amplitude_pct: prevision.amplitude_pct,
    horizon_bougies: prevision.prix.length,
    prix_final: prevision.prix[prevision.prix.length - 1]
  };
}

module.exports = { configure, sante, prevoir, resume };
