/**
 * 5trade — extraction du JSON dans une réponse d'IA.
 *
 * DeepSeek répond en mode `json_object` : le contenu EST du JSON. Les modèles
 * de secours NVIDIA NIM, eux, encadrent volontiers leur réponse de ```json ou
 * d'une phrase d'introduction. Sans ce nettoyage, chaque bascule cassait le
 * `JSON.parse()` de l'appelant alors que la réponse était parfaitement valide.
 */

/** Rend une chaîne exploitable par JSON.parse : bloc ```json, ou 1er { / [ au dernier } / ]. */
function extraireJSON(texte) {
  const t = String(texte == null ? '' : texte).trim();
  if (!t) return t;

  // 1. Déjà du JSON propre.
  if (t.startsWith('{') || t.startsWith('[')) return t;

  // 2. Bloc de code Markdown : ```json ... ``` ou ``` ... ```
  const bloc = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (bloc && bloc[1] && bloc[1].trim()) return bloc[1].trim();

  // 3. Sinon : du premier { ou [ jusqu'au dernier } ou ].
  const debut = t.search(/[[{]/);
  if (debut >= 0) {
    const fin = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (fin > debut) return t.slice(debut, fin + 1);
  }
  return t;
}

module.exports = { extraireJSON };
