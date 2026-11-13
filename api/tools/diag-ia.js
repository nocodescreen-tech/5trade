/**
 * Diagnostic des modèles NVIDIA : lequel répond, en combien de temps, et avec
 * quel budget de tokens. Sert à choisir un délai réaliste au lieu de deviner.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const MODELEES = (process.env.NVIDIA_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
const URL = process.env.NVIDIA_URL || 'https://integrate.api.nvidia.com/v1/chat/completions';
const cle = process.env.NVIDIA_API_KEY;

async function essai(modele, maxTokens, timeoutMs) {
  const t0 = Date.now();
  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modele,
        messages: [
          { role: 'system', content: 'Réponds uniquement par un JSON valide.' },
          { role: 'user', content: '{"action":"HOLD","raison":"test"}' }
        ],
        max_tokens: maxTokens,
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const brut = await r.text();
    let d = {};
    try { d = JSON.parse(brut); } catch { }
    const ms = Date.now() - t0;
    if (!r.ok) return { modele, ms, ok: false, erreur: `HTTP ${r.status} ${String(d.detail || brut).slice(0, 90)}` };
    const c = (d.choices || [])[0] || {};
    const contenu = (c.message && c.message.content) || '';
    return {
      modele, ms, ok: !!String(contenu).trim(),
      finish: c.finish_reason,
      sortie: d.usage && d.usage.completion_tokens,
      longueur: String(contenu).length,
      raisonnement: ((c.message && c.message.reasoning_content) || '').length,
      extrait: String(contenu).slice(0, 70).replace(/\n/g, ' ')
    };
  } catch (e) {
    return { modele, ms: Date.now() - t0, ok: false, erreur: e.name === 'TimeoutError' ? 'timeout' : e.message.slice(0, 90) };
  }
}

(async () => {
  if (!cle) { console.log('NVIDIA_API_KEY absente'); process.exit(1); }
  const modeles = MODELEES.length ? MODELEES : ['nvidia/nemotron-3-ultra-550b-a55b'];
  console.log(`${modeles.length} modèle(s) · budget testé : 4000 puis 12000 tokens\n`);
  for (const m of modeles) {
    const a = await essai(m, 4000, 60000);
    console.log(`${m}`);
    console.log(`  4000 tokens : ${a.ok ? 'OK' : 'échec'} · ${a.ms} ms`
      + (a.ok ? ` · finish=${a.finish} · sortie=${a.sortie} · ${a.longueur} car. · « ${a.extrait} »`
        : ` · ${a.erreur}`));
    if (!a.ok) {
      const b = await essai(m, 12000, 90000);
      console.log(`  12000 tokens: ${b.ok ? 'OK' : 'échec'} · ${b.ms} ms`
        + (b.ok ? ` · finish=${b.finish} · sortie=${b.sortie} · raisonnement=${b.raisonnement} car. · « ${b.extrait} »`
          : ` · ${b.erreur}`));
    }
  }
  process.exit(0);
})();
