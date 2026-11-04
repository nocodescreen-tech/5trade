/**
 * 5trade — recherche plein-texte dans la base de connaissance.
 *
 * Le matching historique se contentait de chercher des mots-clés bruts : il
 * ratait les accents (« volatilite » ne trouvait pas « volatilité »), ignorait
 * le poids des champs et n'expliquait pas pourquoi un résultat sortait.
 *
 * Ici : normalisation (accents/casse), pondération (titre > tags > contenu),
 * extrait du passage qui a matché, et score exposé pour rester vérifiable.
 */

/** Minuscules + suppression des accents. */
const normalize = s => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[’']/g, ' ');

/** Découpe une requête en termes utiles (mots de 2 lettres et plus). */
const tokenize = q => normalize(q).split(/[^a-z0-9]+/).filter(t => t.length >= 2);

const WEIGHTS = { title: 6, tags: 3, type: 2, source: 1, content: 1 };

/** Occurrences d'un terme dans un texte déjà normalisé. */
const count = (haystack, term) => {
  if (!haystack || !term) return 0;
  let n = 0, i = 0;
  while ((i = haystack.indexOf(term, i)) !== -1) { n++; i += term.length; }
  return n;
};

/**
 * Extrait le passage autour de la première occurrence d'un terme.
 * Renvoie '' si aucun terme n'est trouvé.
 */
function excerpt(text, tokens, width = 150) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  const hay = normalize(flat);
  for (const t of tokens) {
    const i = hay.indexOf(t);
    if (i === -1) continue;
    const start = Math.max(0, i - Math.floor(width / 3));
    const end = Math.min(flat.length, i + width);
    return (start > 0 ? '…' : '') + flat.slice(start, end).trim() + (end < flat.length ? '…' : '');
  }
  return '';
}

/**
 * Score une stratégie pour une requête.
 * Un terme peut matcher en préfixe (« volatil » trouve « volatilite »).
 */
function scoreStrategy(strategy, tokens) {
  const fields = {
    title: normalize(strategy.title),
    tags: normalize((strategy.tags || []).join(' ')),
    type: normalize(strategy.type),
    source: normalize(strategy.source),
    content: normalize(strategy.content)
  };

  let score = 0;
  const matched = [];
  for (const t of tokens) {
    let best = 0;
    for (const [field, text] of Object.entries(fields)) {
      const exact = count(text, t);
      // préfixe : le terme commence un mot du champ
      const prefix = !exact && text.includes(t) ? 1 : 0;
      const hit = (exact + prefix) * WEIGHTS[field];
      if (hit > best) best = hit;
    }
    if (best > 0) { score += best; matched.push(t); }
  }

  return {
    score,
    matched,
    excerpt: excerpt(strategy.content, tokens)
  };
}

/**
 * Recherche triée. Un document ne sort que s'il matche TOUS les termes
 * (recherche stricte, comme un « AND ») — c'est ce qu'on attend d'un filtre.
 */
function search(strategies, query, { limit = 50 } = {}) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  return strategies
    .map(s => ({ strategy: s, ...scoreStrategy(s, tokens) }))
    .filter(r => r.matched.length === tokens.length)
    .sort((a, b) => b.score - a.score || String(a.strategy.title).localeCompare(String(b.strategy.title)))
    .slice(0, limit)
    .map(r => ({
      id: r.strategy.id,
      title: r.strategy.title,
      type: r.strategy.type,
      source: r.strategy.source,
      tags: r.strategy.tags || [],
      createdAt: r.strategy.createdAt || r.strategy.uploadDate || null,
      score: r.score,
      excerpt: r.excerpt
    }));
}

module.exports = { search, scoreStrategy, tokenize, normalize, excerpt };
