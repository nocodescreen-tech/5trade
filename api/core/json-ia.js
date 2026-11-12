/**
 * 5trade — extraction du JSON dans une réponse d'IA.
 *
 * Les modèles encadrent volontiers leur réponse de ```json ou d'une phrase
 * d'introduction : sans nettoyage, chaque bascule cassait le `JSON.parse()` de
 * l'appelant alors que la réponse était exploitable.
 *
 * Second défaut, vu en production : un modèle « reasoning » peut rendre un JSON
 * TRONQUÉ (budget de tokens mangé par le raisonnement) ou contenir un vrai
 * retour à la ligne à l'intérieur d'une chaîne. Le parseur rendait alors
 * « Unterminated string in JSON at position 29 », et l'écran affichait
 * « Combinaison indisponible » sur un plan pourtant à moitié utilisable.
 * On répare ce qui est réparable, et on ne renvoie JAMAIS pire que l'entrée.
 */

/** Vrai si la chaîne est un JSON valide. */
function estValide(t) {
  try { JSON.parse(t); return true; } catch { return false; }
}

/** Nettoyage historique : bloc Markdown, puis du premier { / [ au dernier } / ]. */
function extraire(texte) {
  const t = String(texte == null ? '' : texte).trim();
  if (!t) return t;
  if (t.startsWith('{') || t.startsWith('[')) return t;

  const bloc = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (bloc && bloc[1] && bloc[1].trim()) return bloc[1].trim();

  const debut = t.search(/[[{]/);
  if (debut >= 0) {
    const fin = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (fin > debut) return t.slice(debut, fin + 1);
  }
  return t;
}

/**
 * Répare un JSON abîmé :
 *   • échappe les caractères de contrôle laissés bruts dans une chaîne
 *     (un retour à la ligne réel est interdit en JSON) ;
 *   • referme une chaîne non terminée ;
 *   • retire une virgule finale et referme les { } / [ ] restés ouverts
 *     (cas d'une réponse tronquée).
 * Renvoie `null` si le résultat reste invalide.
 */
function reparer(t) {
  const src = String(t || '').trim();
  if (!src) return null;

  let out = '';
  let dansChaine = false;
  let echappe = false;
  const pile = [];                       // accolades/crochets ouverts, hors chaîne

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (dansChaine) {
      if (echappe) { out += c; echappe = false; continue; }
      if (c === '\\') { out += c; echappe = true; continue; }
      if (c === '"') { out += c; dansChaine = false; continue; }
      // Caractère de contrôle littéral → séquence d'échappement.
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
      if (c < ' ') { out += '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'); continue; }
      out += c;
      continue;
    }

    if (c === '"') { dansChaine = true; out += c; continue; }
    if (c === '{' || c === '[') { pile.push(c); out += c; continue; }
    if (c === '}' || c === ']') {
      // Fermeture orpheline : on l'ignore plutôt que d'invalider tout le document.
      if (!pile.length) continue;
      pile.pop();
      out += c;
      continue;
    }
    out += c;
  }

  // Chaîne encore ouverte (troncature au milieu d'un texte).
  if (dansChaine) out += '"';

  // Virgule / deux-points pendants en fin de document tronqué.
  out = out.replace(/,\s*$/, '').replace(/:\s*$/, ': null');

  // Referme les structures restées ouvertes, de la plus interne à la plus externe.
  for (let i = pile.length - 1; i >= 0; i--) {
    out += pile[i] === '{' ? '}' : ']';
  }
  // Un objet qui se termine par une virgule après fermeture reste invalide :
  // on nettoie une dernière fois.
  out = out.replace(/,\s*([}\]])/g, '$1');

  return estValide(out) ? out : null;
}

/**
 * Rend une chaîne exploitable par JSON.parse.
 * Sur un document abîmé, renvoie la version réparée si elle est valide ;
 * sinon l'entrée d'origine — l'appelant garde son comportement d'erreur.
 */
function extraireJSON(texte) {
  const brut = extraire(texte);
  if (!brut) return brut;
  if (estValide(brut)) return brut;
  const repare = reparer(brut);
  return repare || brut;
}

/** Parse direct : JSON.parse avec réparation. Lève si vraiment irrécupérable. */
function parseJSON(texte) {
  return JSON.parse(extraireJSON(texte));
}

module.exports = { extraireJSON, parseJSON, reparer, estValide };
