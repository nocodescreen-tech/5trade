/**
 * Découverte des modèles NVIDIA réellement utilisables.
 *
 * On ne devine plus : on demande la liste à l'API, puis on envoie à CHAQUE
 * modèle un prompt minuscule en chronométrant la réponse. Ne restent que ceux
 * qui répondent vraiment, classés par latence.
 *
 * Usage : node tools/decouvrir-modeles.js [--tous] [--max=12]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const BASE = (process.env.NVIDIA_URL || 'https://integrate.api.nvidia.com/v1/chat/completions')
  .replace(/\/chat\/completions$/, '');
const CLE = process.env.NVIDIA_API_KEY;
const TIMEOUT = Number(process.env.DIAG_TIMEOUT_MS || 12000);
const CONCURRENCE = Number(process.env.DIAG_CONCURRENCE || 6);

async function listerModeles() {
  const r = await fetch(`${BASE}/models`, {
    headers: { Authorization: `Bearer ${CLE}` },
    signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) throw new Error(`liste des modèles : HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
  const d = await r.json();
  return (d.data || []).map(m => m.id).filter(Boolean).sort();
}

async function tester(modele) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CLE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modele,
        messages: [
          { role: 'system', content: 'Réponds uniquement par un JSON valide, sans texte.' },
          { role: 'user', content: 'Donne un objet JSON {"ok":true} et rien d autre.' }
        ],
        max_tokens: Number(process.env.DIAG_TOKENS || 2000),
        temperature: 0
      }),
      signal: AbortSignal.timeout(TIMEOUT)
    });
    const ms = Date.now() - t0;
    const brut = await r.text();
    let d = {};
    try { d = JSON.parse(brut); } catch { }
    if (!r.ok) {
      const msg = String(d.detail || d.error?.message || brut).slice(0, 80);
      return { modele, ok: false, ms, raison: `HTTP ${r.status} — ${msg}` };
    }
    const c = (d.choices || [])[0] || {};
    const contenu = String((c.message && c.message.content) || '').trim();
    if (!contenu) return { modele, ok: false, ms, raison: `vide (finish=${c.finish_reason || '?'})` };
    return { modele, ok: true, ms, sortie: contenu.slice(0, 40).replace(/\n/g, ' ') };
  } catch (e) {
    return {
      modele, ok: false, ms: Date.now() - t0,
      raison: e.name === 'TimeoutError' ? `timeout ${TIMEOUT} ms` : String(e.message).slice(0, 80)
    };
  }
}

/** Parallélisme borné : on teste vite sans saturer l'API. */
async function parLots(items, taille, fn) {
  const sortie = [];
  for (let i = 0; i < items.length; i += taille) {
    sortie.push(...await Promise.all(items.slice(i, i + taille).map(fn)));
  }
  return sortie;
}

(async () => {
  if (!CLE) { console.log('NVIDIA_API_KEY absente du .env'); process.exit(1); }
  const args = process.argv.slice(2);
  const max = Number((args.find(a => a.startsWith('--max=')) || '--max=999').split('=')[1]);

  const tous = await listerModeles();
  console.log(`NVIDIA expose ${tous.length} modèle(s). Test de chacun (${TIMEOUT} ms, ${CONCURRENCE} en parallèle)…\n`);

  const aTester = tous.slice(0, max);
  const res = await parLots(aTester, CONCURRENCE, tester);

  const ok = res.filter(r => r.ok).sort((a, b) => a.ms - b.ms);
  const ko = res.filter(r => !r.ok);

  console.log(`=== OPÉRATIONNELS (${ok.length}/${res.length}) — classés par latence`);
  for (const r of ok) console.log(`  ${String(r.ms).padStart(6)} ms  ${r.modele}`);
  console.log(`\n=== INDISPONIBLES (${ko.length})`);
  for (const r of ko.slice(0, 25)) console.log(`  ${String(r.ms).padStart(6)} ms  ${r.modele} — ${r.raison}`);

  if (ok.length) {
    console.log('\nCascade recommandée (copier dans .env) :');
    console.log(`NVIDIA_MODELS=${ok.slice(0, 3).map(r => r.modele).join(',')}`);
  }
  process.exit(0);
})().catch(e => { console.log('ERREUR:', String(e.message).slice(0, 200)); process.exit(1); });
