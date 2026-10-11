/**
 * 5trade — analyse visuelle des captures de graphiques.
 *
 * Deux backends interchangeables, choisis explicitement par VISION_PROVIDER
 * (aucun basculement automatique silencieux) :
 *
 *   gemini   → Google Gemini (défaut). GEMINI_API_KEY, GEMINI_VISION_MODEL.
 *   deepseek → API DeepSeek multimodale. Réutilise DEEPSEEK_API_KEY / DEEPSEEK_MODEL.
 *
 * Les deux ont été testés sur une vraie capture : ils décrivent correctement
 * structure, BOS/CHoCH, zones de liquidité.
 */
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEEPSEEK_URL = process.env.DEEPSEEK_URL_VISION || 'https://api.deepseek.com/v1/chat/completions';

const provider = () => (process.env.VISION_PROVIDER || 'gemini').toLowerCase();
const geminiModel = () => process.env.GEMINI_VISION_MODEL || 'gemini-3.8-flash';

/** Le backend courant est-il utilisable (clé présente) ? */
function visionReady() {
  return provider() === 'deepseek'
    ? !!process.env.DEEPSEEK_API_KEY
    : !!process.env.GEMINI_API_KEY;
}

/** Décrit le backend actif, pour l'affichage/logs. */
function visionInfo() {
  return provider() === 'deepseek'
    ? { provider: 'deepseek', model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' }
    : { provider: 'gemini', model: geminiModel() };
}

async function geminiAnalyze(images, prompt) {
  const parts = [{ text: prompt }];
  for (const img of images) {
    parts.push({ inline_data: { mime_type: img.mimeType || 'image/png', data: img.base64 } });
  }

  const res = await fetch(`${GEMINI_API}/${geminiModel()}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192 }
    })
  });
  if (!res.ok) {
    throw new Error(`Gemini ${res.status} — ${(await res.text().catch(() => '')).slice(0, 300)}`);
  }

  const data = await res.json();
  const cand = data.candidates && data.candidates[0];
  if (!cand) {
    const why = data.promptFeedback && data.promptFeedback.blockReason;
    throw new Error(why ? `Gemini a bloqué la requête (${why})` : 'Gemini : réponse vide');
  }
  const text = ((cand.content && cand.content.parts) || [])
    .map(p => p.text).filter(Boolean).join('\n').trim();
  if (!text) throw new Error(`Gemini : aucun texte (finishReason=${cand.finishReason || '?'})`);
  return text;
}

async function deepseekAnalyze(images, prompt) {
  const content = [{ type: 'text', text: prompt }];
  for (const img of images) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType || 'image/png'};base64,${img.base64}` }
    });
  }

  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      messages: [{ role: 'user', content }],
      max_tokens: 8192,
      temperature: 0.3
    })
  });
  if (!res.ok) {
    throw new Error(`DeepSeek ${res.status} — ${(await res.text().catch(() => '')).slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message
    && data.choices[0].message.content;
  if (!text) throw new Error('DeepSeek : réponse vide');
  return String(text).trim();
}

/**
 * @param {Array<{mimeType:string, base64:string}>} images
 * @param {string} prompt
 * @returns {Promise<string>} l'analyse en texte
 */
async function analyzeImages(images, prompt) {
  if (!visionReady()) throw new Error(`Clé API manquante pour VISION_PROVIDER=${provider()}`);
  if (!images.length) throw new Error('Aucune image à analyser');
  return provider() === 'deepseek'
    ? deepseekAnalyze(images, prompt)
    : geminiAnalyze(images, prompt);
}

module.exports = { visionReady, visionInfo, analyzeImages, provider };
