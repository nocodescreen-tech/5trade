/**
 * 5trade — Chat CRUD : parseur de commandes en langage naturel.
 *
 * Transforme un message utilisateur en action structurée :
 *   { verbe, sujet, parametres }
 *
 * Sept verbes reconnus :
 *   MONTRE     — lecture (trades, scénarios, état, mémoire)
 *   CRÉE       — ajout (stratégie, exception, scénario)
 *   MODIFIE    — changement (paramètre, seuil, stratégie)
 *   SUPPRIME   — retrait (stratégie, exception)
 *   ACTIVE     — bascule on (stratégie, killzone)
 *   DÉSACTIVE  — bascule off
 *   EXPLIQUE   — raisonnement rétroactif (pourquoi ce trade ?)
 *   APPRENDS   — enseigne au système (correction humaine)
 *
 * Le parseur utilise des patterns regex pour 80% des commandes.
 * Le fallback LLM (NVIDIA NIM) gère les 20% non reconnus.
 */

const PATTERNS = [
  { regex: /^(?:liste|montre|affiche)\s+(?:les\s+)?(?:skills|compétences)\s*$/i, verbe: 'MONTRE', sujet: 'skills_liste', type:'skill' },
  { regex: /^(?:crée|cree|ajoute|génère|genere)\s+(?:(?:un|une)\s+)?(?:skill|compétence)\s+([\s\S]+)$/i, verbe:'CRÉE', type:'skill' },
  { regex: /^active\s+(?:skill|compétence)\s+([a-z0-9_-]{3,50})$/i, verbe:'ACTIVE', type:'skill' },
  { regex: /^(?:désactive|desactive)\s+(?:skill|compétence)\s+([a-z0-9_-]{3,50})$/i, verbe:'DÉSACTIVE', type:'skill' },
  { regex: /^(?:calcule|exécute|execute)\s+skill\s+([\s\S]+)$/i, verbe:'MONTRE', type:'skill_calcul' },

  // 5 QUESTIONS D'AUDIT & PILOTAGE DIRECT
  // 1. « Quels marchés surveilles-tu ? » / « qu'as-tu scanné ? »
  { regex: /^(?:quels?\s+march[ée]s?\s+surveilles?-tu|qu'as-tu\s+(?:r[ée]ellement\s+)?scann[ée]|quels?\s+sont\s+les\s+march[ée]s?\s+actifs?|march[ée]s?\s+surveill[ée]s?)\b/i, verbe: 'MONTRE', sujet: 'marches_surveilles' },
  // 2. « Pourquoi aucun signal sur XAUUSD / en M5 ? »
  { regex: /^(?:pourquoi\s+(?:aucun\s+signal|pas\s+de\s+signal)|pourquoi\s+aucun\s+trade)\b/i, verbe: 'EXPLIQUE', sujet: 'pourquoi_pas_signal' },
  // 3. « Est-ce que le CPI bloque l'or / USD ? »
  { regex: /^(?:est-ce\s+que\s+(?:le\s+)?cpi\s+bloque|cpi\s+bloque|calendrier\s+cpi|impact\s+cpi)\b/i, verbe: 'MONTRE', sujet: 'blocage_cpi' },
  // 4. « Pourquoi je n'ai rien reçu sur Telegram ? »
  { regex: /^(?:pourquoi\s+(?:je\s+n'ai\s+rien\s+re[çc]u|pas\s+de\s+notif|pas\s+d'alerte)|(?:statut|probl[èe]me)\s+telegram)\b/i, verbe: 'EXPLIQUE', sujet: 'statut_telegram' },
  // 5. « Qu'est-ce que tu as mémorisé / préférences ? »
  { regex: /^qu'est-ce\s+que\s+tu\s+as\s+m[ée]moris[ée]|^mes\s+pr[ée]f[ée]rences\b/i, verbe: 'MONTRE', sujet: 'preferences_memorisees' },

  // MONTRE
  { regex: /^(?:montre(?:\s+moi)?|affiche|liste|donne)\s+(.*)$/i, verbe: 'MONTRE' },
  { regex: /^état\s+(?:du\s+)?(?:système|systeme|sante|santé)\s*$/i, verbe: 'MONTRE', sujet: 'etat_systeme' },
  { regex: /^état\s+(?:d[ue]\s+)?(.+)$/i, verbe: 'MONTRE' },
  { regex: /^qu'est-ce que tu (?:sais|connais)/i, verbe: 'MONTRE', sujet: 'memoire' },
  { regex: /^qu'est-ce que tu as appris/i, verbe: 'MONTRE', sujet: 'apprentissage' },

  // CRÉE
  { regex: /^(?:cr[ée]e|ajoute|nouvelle?)\s+(?:une\s+)?(.+)$/i, verbe: 'CRÉE' },

  // MODIFIE
  { regex: /^(?:modifie|ajuste|change|r[èe]gle|configure)\s+(.+)$/i, verbe: 'MODIFIE' },

  // SUPPRIME
  { regex: /^(?:supprime|retire|efface|d[ée]truis)\s+(.+)$/i, verbe: 'SUPPRIME' },

  // ACTIVE
  { regex: /^(?:active|allume)\s+(.+)$/i, verbe: 'ACTIVE' },

  // DÉSACTIVE
  { regex: /^(?:d[ée]sactive|[ée]teins)\s+(.+)$/i, verbe: 'DÉSACTIVE' },

  // EXPLIQUE
  { regex: /^(?:pourquoi|explique|raison)\s+(.+)$/i, verbe: 'EXPLIQUE' },
  { regex: /^et si/i, verbe: 'SIMULE' },

  // APPRENDS
  { regex: /^(?:apprends?|retiens|m[ée]morise|note\s+(?:ceci|bien)?(?:\s+pour\s+toujours)?|souviens-toi\s+(?:de\s+cette\s+r[èe]gle\s+)?|garde\s+en\s+m[ée]moire)\s+(?:que\s+|de\s+)?(.+)$/i, verbe: 'APPRENDS' },
  { regex: /^(?:non|erreur|faux)\s*[:\-]?\s*(.+)$/i, verbe: 'APPRENDS', type: 'correction' },

  // AIDE
  { regex: /^(?:aide|help|commandes)\s*$/i, verbe: 'AIDE' },
];

/**
 * @param {string} message
 * @returns {{verbe:string, sujet:string, type?:string}|{llm:boolean, message:string}}
 */
function parser(message) {
  if (!message || typeof message !== 'string') return { verbe: 'INCONNU', sujet: '' };
  const msg = message.trim();

  for (const p of PATTERNS) {
    const m = msg.match(p.regex);
    if (m) {
      return {
        verbe: p.verbe,
        sujet: p.sujet || (m[1] ? m[1].trim() : ''),
        type: p.type || null,
        brut: msg,
      };
    }
  }

  // Fallback LLM : signaler que le parseur n'a pas reconnu
  return { verbe: 'LLM', sujet: '', brut: msg, llm: true };
}

/**
 * Tentative d'extraction structurée pour les commandes MODIFIE.
 * Exemple : "modifie le stop ATR à 1.2 sur XAUUSD"
 * → { parametre: 'stop.atr_multiplier[XAUUSD]', valeur: 1.2 }
 *
 * Si l'extraction échoue, l'executeur demandera une clarification.
 */
function extraireModification(sujet) {
  // "le stop ATR à 1.2 sur XAUUSD"
  const m1 = sujet.match(/(?:le\s+|la\s+|l[ea]\s+)?([\w.]+(?:\[[\w]+\])?)\s+(?:à|a|=|en)\s+([0-9.]+)(?:\s+sur\s+(\w+))?/i);
  if (m1) {
    const param = m1[1].toLowerCase().replace(/\s+/g, '_');
    const valeur = Number(m1[2]);
    const instr = m1[3] || null;
    return {
      parametre: instr ? `${param}[${instr}]` : param,
      valeur: Number.isFinite(valeur) ? valeur : null,
    };
  }
  return null;
}

/**
 * Extraction pour CRÉE exception.
 * "ne pas trader EURUSD vendredi après 16h"
 */
function extraireException(sujet) {
  if (!/ne pas|interdit|évite/i.test(sujet)) return null;
  const instrument = (sujet.match(/(EURUSD|GBPUSD|USDJPY|XAUUSD|BTCUSDT)/i) || [])[1];
  const vendredi = /vendredi/i.test(sujet);
  const apresMatch = sujet.match(/apr[èe]s\s+(\d{1,2})\s*h/i);
  const avantMatch = sujet.match(/avant\s+(\d{1,2})\s*h/i);

  if (instrument && (vendredi || apresMatch || avantMatch)) {
    return {
      titre: sujet.slice(0, 80),
      regle: {
        instrument,
        jour: vendredi ? 'vendredi' : undefined,
        heure_min: apresMatch ? Number(apresMatch[1]) : undefined,
        heure_max: avantMatch ? Number(avantMatch[1]) : undefined,
      },
      raison: 'créée via chat CRUD',
      source: 'humain',
    };
  }
  return null;
}

module.exports = { parser, extraireModification, extraireException };
