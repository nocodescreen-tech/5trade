/**
 * 5trade — base de CONCEPTS de trading.
 *
 * Distinct des stratégies : ici on ne dit pas « quoi trader » mais « de quoi on
 * parle ». Chaque terme porte sa définition, comment le repérer sur un
 * graphique, les pièges fréquents, et ce que le moteur en fait.
 *
 * À quoi ça sert concrètement : ces définitions sont INJECTÉES dans l'analyse
 * (voir pourAnalyse). Sans elles, le modèle emploie « order block » à tort et à
 * travers ; avec elles, il sait qu'une zone de demande prise par le haut en
 * premium n'est pas un achat.
 *
 * Le contenu est volontairement vérifiable : pas de folklore, seulement ce qui
 * se lit sur les bougies.
 */

const CATEGORIES = {
  structure: 'Structure de marché',
  zones: 'Zones et blocs',
  liquidite: 'Liquidité',
  prix: 'Prix et niveaux',
  temps: 'Temps et sessions',
  momentum: 'Momentum',
  base: 'Notions de base',
  gestion: 'Gestion du risque'
};

const CONCEPTS = [
  // ── Structure ────────────────────────────────────────────────────────────
  {
    id: 'bos', terme: 'BOS — Break of Structure', alias: ['bos', 'rupture de structure', 'break of structure'],
    categorie: 'structure',
    definition: "Cassure d'un sommet (ou d'un creux) structurel dans le sens de la tendance en cours, confirmée par la clôture. Le marché poursuit son mouvement.",
    identification: [
      "Tendance déjà établie (sommets et creux croissants, ou décroissants).",
      "Une bougie CLÔTURE au-delà du dernier sommet (BOS haussier) ou du dernier creux (BOS baissier).",
      "Une mèche qui dépasse sans clôturer n'est pas un BOS : c'est un balayage."
    ],
    pieges: ["Prendre une mèche pour une cassure.", "Appeler BOS une cassure contre la tendance : c'est un CHoCH."],
    utilisation: "Confirme la continuation. Sert de déclencheur d'entrée et de niveau de référence pour le stop."
  },
  {
    id: 'choch', terme: 'CHoCH — Change of Character', alias: ['choch', 'changement de caractère', 'changement de caractere'],
    categorie: 'structure',
    definition: "Cassure, par la clôture, du dernier point structurel CONTRE la tendance en place. Annonce un retournement probable, pas encore confirmé.",
    identification: [
      "Tendance haussière : cassure du dernier creux significatif.",
      "Tendance baissière : cassure du dernier sommet significatif.",
      "Plus fiable s'il survient après un balayage de liquidité."
    ],
    pieges: ["Le confondre avec un BOS.", "Le prendre pour un retournement certain : c'est un premier signal, il demande confirmation par un déplacement."],
    utilisation: "Pèse plus lourd qu'un BOS dans le verdict : il marque le changement de camp."
  },
  {
    id: 'mss', terme: 'MSS — Market Structure Shift', alias: ['mss', 'structure shift'],
    categorie: 'structure',
    definition: "Déplacement violent qui casse la structure : l'équivalent d'un CHoCH accompagné de bougies à large corps. C'est la signature d'une prise de contrôle.",
    identification: ["Cassure de structure ET corps de bougie nettement supérieur à l'ATR.", "Souvent après un raid sur la liquidité opposée."],
    pieges: ["Le voir partout : sans déplacement, ce n'est qu'un CHoCH ordinaire."],
    utilisation: "Confirme le changement de main. Renforce fortement un verdict de retournement."
  },
  {
    id: 'hh-hl', terme: 'HH / HL — Higher High, Higher Low', alias: ['hh', 'hl', 'higher high', 'higher low'],
    categorie: 'structure',
    definition: "Séquence de sommets et de creux de plus en plus hauts. C'est la définition mécanique d'une tendance haussière.",
    identification: ["Chaque sommet dépasse le précédent.", "Chaque creux reste au-dessus du précédent."],
    pieges: ["Un seul sommet plus haut ne fait pas une tendance."],
    utilisation: "Base du calcul de tendance du moteur. Si la séquence se brise, un retournement est possible."
  },
  {
    id: 'lh-ll', terme: 'LH / LL — Lower High, Lower Low', alias: ['lh', 'll', 'lower high', 'lower low'],
    categorie: 'structure',
    definition: "Sommets et creux de plus en plus bas : définition mécanique d'une tendance baissière.",
    identification: ["Chaque sommet reste sous le précédent.", "Chaque creux casse le précédent."],
    pieges: ["Confondre une correction dans une hausse avec un début de baisse."],
    utilisation: "Symétrique de HH/HL pour la baisse."
  },
  {
    id: 'range', terme: 'Range — marché en range', alias: ['range', 'range', 'consolidation', 'lateral'],
    categorie: 'structure',
    definition: "Le prix oscille entre un haut et un bas sans direction nette. Ni tendance haussière, ni baissière.",
    identification: ["Sommets et creux sensiblement au même niveau.", "L'ATR se compresse."],
    pieges: ["Trader le range comme une tendance.", "Ignorer que les ranges se cassent souvent par un balayage."],
    utilisation: "Le moteur rend un biais neutre : aucun scénario n'est privilégié, on attend la cassure."
  },
  {
    id: 'swing', terme: 'Swing — sommet / creux', alias: ['swing', 'sommet', 'creux', 'fractal'],
    categorie: 'structure',
    definition: "Point de retournement local : un sommet est plus haut que les bougies de part et d'autre, un creux plus bas. C'est l'unité de base de la structure.",
    identification: ["Sommet : le plus haut des 2 bougies avant et après.", "Creux : symétrique vers le bas."],
    pieges: ["Prendre un plateau (deux bougies au même niveau) pour deux swings."],
    utilisation: "Tout le reste en découle : structure, zones, stops, objectifs."
  },

  // ── Zones ────────────────────────────────────────────────────────────────
  {
    id: 'ob', terme: 'Order Block (OB)', alias: ['ob', 'order block', 'bloc d\'ordres', 'orderblock'],
    categorie: 'zones',
    definition: "Dernière bougie de sens contraire avant un déplacement marqué. On suppose que des ordres importants y ont été laissés, ce qui en fait une zone de réaction probable.",
    identification: [
      "Bougie baissière suivie d'une impulsion haussière qui dépasse le haut des bougies précédentes → OB haussier (zone de demande).",
      "Bougie haussière suivie d'une impulsion baissière → OB baissier (zone d'offre).",
      "La zone va du bas au haut de cette bougie."
    ],
    pieges: [
      "Acheter un OB haussier situé AU-DESSUS de l'équilibre du range : le prix vient d'en haut, la réaction naturelle est baissière.",
      "Utiliser un OB déjà traversé par la clôture : il n'est plus valide, il devient un breaker."
    ],
    utilisation: "Zone d'entrée privilégiée, mais SEULEMENT du bon côté du range : zone de demande en discount pour acheter, zone d'offre en premium pour vendre."
  },
  {
    id: 'fvg', terme: 'FVG — Fair Value Gap', alias: ['fvg', 'fair value gap', 'imbalance', 'déséquilibre'],
    categorie: 'zones',
    definition: "Espace laissé entre la mèche d'une bougie et la mèche d'une bougie deux rangs plus loin, quand un déplacement a été trop rapide pour que le prix soit échangé partout. Le marché revient souvent le combler.",
    identification: ["Trois bougies : le haut de la première reste sous le bas de la troisième (gap haussier).", "Inverse pour un gap baissier.", "Considéré comblé dès que le prix le traverse entièrement."],
    pieges: ["Attendre le comblement d'un FVG déjà traversé.", "Oublier que tous les FVG ne sont pas comblés."],
    utilisation: "Le moteur ne garde que les FVG NON comblés : ce sont des aimants potentiels et des niveaux d'entrée fins."
  },
  {
    id: 'imbalance', terme: 'Imbalance — déséquilibre', alias: ['imbalance', 'desequilibre'],
    categorie: 'zones',
    definition: "Notion parente du FVG : zone où l'offre et la demande ne se sont pas équilibrées. Un FVG est un cas précis d'imbalance mesurable sur trois bougies.",
    identification: ["Déplacement rapide laissant un vide entre deux bougies non adjacentes."],
    pieges: ["Confondre imbalance et simple grande bougie : il faut un VIDE entre deux bougies."],
    utilisation: "Zone à surveiller comme cible ou comme entrée."
  },
  {
    id: 'breaker', terme: 'Breaker Block', alias: ['breaker', 'breaker block'],
    categorie: 'zones',
    definition: "Order block qui a été cassé par la clôture. Il change de camp : une zone de demande cassée devient une zone d'offre, et inversement.",
    identification: ["Un OB est traversé par une clôture.", "Le prix revient dessus par l'autre côté et réagit."],
    pieges: ["Continuer à le lire comme une zone de demande après cassure."],
    utilisation: "Zone de retournement de qualité. La stratégie de type « Unicorn » combine breaker et FVG."
  },
  {
    id: 'mitigation', terme: 'Mitigation Block', alias: ['mitigation', 'bloc de mitigation'],
    categorie: 'zones',
    definition: "Zone où un acteur revient couvrir une position prise plus tôt, ce qui provoque une réaction. Proche du breaker, la nuance tient à l'intention supposée.",
    identification: ["Retour du prix sur une zone d'entrée antérieure sans qu'elle ait été cassée."],
    pieges: ["En tirer une certitude : c'est une hypothèse de comportement, pas une mesure."],
    utilisation: "Sert d'explication d'un rejet, jamais de seule raison d'entrer."
  },
  {
    id: 'key-level', terme: 'Key Level — niveau clé', alias: ['key level', 'niveau clé', 'niveau cle'],
    categorie: 'zones',
    definition: "Niveau que le marché a déjà respecté plusieurs fois et qui reste donc décisif : haut ou bas de range, sommet historique, niveau de session.",
    identification: ["Au moins deux réactions nettes au même niveau.", "Le prix le respecte après un intervalle de temps."],
    pieges: ["Tracer trop de niveaux : plus il y en a, moins ils servent."],
    utilisation: "Priorité sur les niveaux secondaires pour placer objectifs et invalidations."
  },
  {
    id: 'support-resistance', terme: 'Support / Résistance', alias: ['support', 'resistance', 'résistance'],
    categorie: 'zones',
    definition: "Le support est un niveau où les acheteurs ont repris le dessus ; la résistance, un niveau où les vendeurs l'ont emporté. En analyse moderne on parle de ZONE, pas de trait.",
    identification: ["Réactions répétées dans une fourchette étroite."],
    pieges: ["Tracer un trait au lieu d'une zone.", "Ignorer qu'un support cassé devient souvent résistance."],
    utilisation: "Structurent le plan : où acheter, où vendre, où l'idée est invalidée."
  },

  // ── Liquidité ────────────────────────────────────────────────────────────
  {
    id: 'liquidity', terme: 'Liquidité', alias: ['liquidité', 'liquidity'],
    categorie: 'liquidite',
    definition: "Ensemble des ordres en attente (stops, ordres limites) regroupés à des endroits évidents. Le marché va souvent les chercher avant de partir dans l'autre sens.",
    identification: ["Sous les creux évidents et au-dessus des sommets évidents.", "Concentrée autour des niveaux ronds et des extrêmes de session."],
    pieges: ["Croire que le prix va toujours chercher la liquidité la plus lointaine."],
    utilisation: "Explique pourquoi une cassure échoue : c'était un raid, pas une vraie cassure."
  },
  {
    id: 'eqh-eql', terme: 'EQH / EQL — égaux hauts / égaux bas', alias: ['eqh', 'eql', 'equal highs', 'equal lows', 'egaux'],
    categorie: 'liquidite',
    definition: "Deux sommets (ou deux creux) au même niveau. C'est un aimant à liquidité : les stops s'y accumulent juste derrière.",
    identification: ["Deux extrêmes séparés par un écart relatif inférieur à environ 0,1 %."],
    pieges: ["Les prendre pour un simple double sommet alors qu'ils marquent une réserve de stops."],
    utilisation: "Cibles naturelles : le moteur les affiche comme objectifs proches, avec leur distance."
  },
  {
    id: 'pdh-pdl', terme: 'PDH / PDL — plus haut / bas de la veille', alias: ['pdh', 'pdl', 'previous day high', 'previous day low'],
    categorie: 'liquidite',
    definition: "Plus haut et plus bas de la journée précédente. Références que le marché vient souvent tester.",
    identification: ["Calculés sur les bougies de la veille, en UTC."],
    pieges: ["Les calculer sur un fuseau différent de celui des bougies : les niveaux seraient faux."],
    utilisation: "Le moteur les calcule dès qu'il a assez d'historique et les inclut aux niveaux exploitables."
  },
  {
    id: 'sweep', terme: 'Sweep — balayage de liquidité', alias: ['sweep', 'balayage', 'raid', 'stop hunt'],
    categorie: 'liquidite',
    definition: "Une mèche dépasse un niveau évident puis la bougie clôture de l'autre côté. On est venu chercher les stops, pas poursuivre le mouvement.",
    identification: ["La mèche dépasse un sommet ou un creux.", "La clôture revient du côté opposé."],
    pieges: ["Confondre un balayage avec une cassure : c'est l'inverse (l'une clôture au-delà, l'autre non)."],
    utilisation: "Signal fort : pèse dans le verdict et explique un retournement."
  },
  {
    id: 'premium-discount', terme: 'Premium / Discount', alias: ['premium', 'discount', 'equilibre', 'equilibrium'],
    categorie: 'prix',
    definition: "Découpage du range en deux : au-dessus de l'équilibre (milieu) on est en premium, en dessous en discount. On achète en discount, on vend en premium.",
    identification: ["Range = dernier sommet et dernier creux significatifs.", "Équilibre = milieu exact."],
    pieges: ["Acheter en premium sous prétexte que la tendance est haussière : c'est le piège le plus coûteux."],
    utilisation: "Critère décisif : il départage les scénarios et conditionne la validité d'une zone."
  },
  {
    id: 'ote', terme: 'OTE — Optimal Trade Entry', alias: ['ote', 'optimal trade entry'],
    categorie: 'prix',
    definition: "Zone de retracement comprise entre 61,8 % et 79 % d'un mouvement, réputée offrir le meilleur compromis entre entrée et invalidation.",
    identification: ["Tracé de Fibonacci sur le dernier mouvement, entre 0,618 et 0,79."],
    pieges: ["L'utiliser sans que la structure soit alignée."],
    utilisation: "Le moteur expose le niveau 0,618 du range comme niveau d'entrée privilégié."
  },
  {
    id: 'fibonacci', terme: 'Fibonacci — retracement et extension', alias: ['fibonacci', 'fibo', 'retracement', 'extension'],
    categorie: 'prix',
    definition: "Découpage d'un mouvement selon des proportions (23,6 % · 38,2 % · 50 % · 61,8 % · 78,6 %). Sert à situer les replis attendus et les objectifs.",
    identification: ["Tracé entre le début et la fin du dernier mouvement."],
    pieges: ["Chercher une précision au point près : ce sont des zones."],
    utilisation: "Le moteur calcule les six niveaux du dernier swing et marque la zone OTE."
  },
  {
    id: 'golden-zone', terme: 'Golden Zone', alias: ['golden zone', 'zone dorée'],
    categorie: 'prix',
    definition: "Fourchette de retracement 50 % – 61,8 %, réputée la plus favorable pour entrer dans le sens de la tendance.",
    identification: ["Fibonacci du dernier mouvement, entre 0,5 et 0,618."],
    pieges: ["L'attendre alors que le marché ne la touche jamais : prévoir un plan sans elle."],
    utilisation: "Se combine avec OB et FVG pour resserrer une entrée."
  },

  // ── Temps ────────────────────────────────────────────────────────────────
  {
    id: 'kill-zone', terme: 'Kill Zone', alias: ['kill zone', 'killzone'],
    categorie: 'temps',
    definition: "Plage horaire où la volatilité et les mouvements directionnels sont les plus marqués : ouverture de Londres (7 h – 10 h UTC) et de New York (12 h – 15 h UTC).",
    identification: ["Segments horaires, en UTC, des sessions majeures."],
    pieges: ["Trader les mêmes configurations hors des plages actives : les faux signaux y sont plus nombreux."],
    utilisation: "Le moteur indique la session en cours et si l'on est dans une kill zone."
  },
  {
    id: 'session', terme: 'Sessions — Asie / Londres / New York', alias: ['session', 'asie', 'londres', 'new york', 'tokyo'],
    categorie: 'temps',
    definition: "Trois grands moments de la journée. L'Asie construit souvent un range étroit, Londres le casse, New York prolonge ou retourne.",
    identification: ["Asie 0 h – 8 h UTC · Londres 7 h – 16 h · New York 12 h – 21 h · chevauchement 12 h – 16 h."],
    pieges: ["Comparer des données horodatées dans deux fuseaux différents."],
    utilisation: "Le moteur rattache chaque bougie à sa session et décrit la journée qui se dessine."
  },

  // ── Momentum ─────────────────────────────────────────────────────────────
  {
    id: 'displacement', terme: 'Displacement — déplacement', alias: ['displacement', 'déplacement', 'deplacement'],
    categorie: 'momentum',
    definition: "Mouvement rapide et large, corps de bougie nettement supérieur à la volatilité moyenne. Signature d'une entrée institutionnelle.",
    identification: ["Corps supérieur à environ 1,5 fois l'ATR.", "Laisse souvent un FVG derrière lui."],
    pieges: ["Confondre déplacement et simple bougie de volatilité sans suite."],
    utilisation: "Sans déplacement, une cassure est suspecte : le moteur le mesure et l'expose."
  },
  {
    id: 'impulsion-correction', terme: 'Impulsion / Correction', alias: ['impulsion', 'impulse', 'correction', 'pullback'],
    categorie: 'momentum',
    definition: "L'impulsion va dans le sens de la tendance, la correction la retrace sans la casser. Sait distinguer les deux est la base.",
    identification: ["Impulsion : bougies larges, mouvement rapide.", "Correction : bougies plus petites, rythme irrégulier."],
    pieges: ["Acheter une correction comme si c'était une impulsion."],
    utilisation: "Sert à juger si un repli est une opportunité ou un retournement."
  },
  {
    id: 'momentum', terme: 'Momentum', alias: ['momentum', 'élan'],
    categorie: 'momentum',
    definition: "Force d'un mouvement. Se mesure grossièrement à la taille des corps, au nombre de bougies dans le même sens et à la vitesse.",
    identification: ["Succession de bougies larges dans le même sens.", "Peu de mèches dans le sens contraire."],
    pieges: ["Prendre un sursaut isolé pour du momentum."],
    utilisation: "Alimente la notion de continuation dans le verdict."
  },

  // ── Base ─────────────────────────────────────────────────────────────────
  {
    id: 'atr', terme: 'ATR — Average True Range', alias: ['atr', 'volatilité', 'volatilite'],
    categorie: 'base',
    definition: "Amplitude moyenne des bougies sur une période (14 par défaut). Mesure la volatilité, pas la direction.",
    identification: ["Moyenne des vraies amplitudes des 14 dernières bougies."],
    pieges: ["Fixer un stop en pips sans regarder l'ATR : il serait trop près ou trop loin selon le marché."],
    utilisation: "Le moteur dimensionne les invalidations et les objectifs par rapport à l'ATR."
  },
  {
    id: 'tendance', terme: 'Tendance', alias: ['tendance', 'trend'],
    categorie: 'base',
    definition: "Direction dominante du marché, établie par la séquence des sommets et des creux. Il n'y a pas de tendance dans un range.",
    identification: ["HH/HL pour une hausse, LH/LL pour une baisse."],
    pieges: ["Qualifier de tendance une simple série de trois bougies."],
    utilisation: "Un des deux piliers du biais, avec la position dans le range."
  },
  {
    id: 'rr', terme: 'Ratio risque / rendement (R:R)', alias: ['r:r', 'ratio', 'risk reward'],
    categorie: 'gestion',
    definition: "Rapport entre ce qu'on risque (distance à l'invalidation) et ce qu'on vise. Se note en multiples de risque : viser 3 fois le risque est un 3R.",
    identification: ["Distance entrée → invalidation = 1R.", "Distance entrée → objectif divisée par 1R = le ratio."],
    pieges: ["Viser 5R avec un stop minuscule : l'invalidation serait balayée par le bruit."],
    utilisation: "Le journal calcule le R:R prévu et le R:R réalisé de chaque trade."
  },
  {
    id: 'invalidation', terme: 'Invalidation — niveau d\'erreur', alias: ['invalidation', 'stop', 'stop loss'],
    categorie: 'gestion',
    definition: "Prix au-delà duquel l'idée de trade est fausse. Ce n'est pas un montant de perte : c'est un constat d'erreur.",
    identification: ["Pour un achat : sous le creux structurel qui porte l'idée.", "Pour une vente : au-dessus du sommet équivalent."],
    pieges: ["Placer le stop sur un chiffre rond évident : il sera balayé exprès."],
    utilisation: "Le moteur garantit qu'il est du BON côté : sous l'entrée pour un achat, au-dessus pour une vente."
  },
  {
    id: 'pips-lots', terme: 'Pip, lot, effet de levier', alias: ['pip', 'lot', 'levier', 'leverage'],
    categorie: 'base',
    definition: "Le pip est l'unité de variation la plus courante (quatrième décimale sur la plupart des paires). Le lot est la taille de position. Le levier multiplie l'exposition et la perte.",
    identification: ["Sur EUR/USD, 1 pip = 0,0001. Sur l'or, on compte souvent en dollars."],
    pieges: ["Calculer une taille en pips sans convertir selon l'instrument."],
    utilisation: "Sert au dimensionnement de position ; le journal conserve cette information par trade."
  }
];

const CATEGORIE_IDS = Object.keys(CATEGORIES);
const sansAccents = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Tous les concepts, ou filtrés par catégorie. */
function tous(categorie) {
  return categorie ? CONCEPTS.filter(c => c.categorie === categorie) : CONCEPTS;
}

/** Recherche simple : terme, alias, définition. */
function chercher(q) {
  const t = sansAccents(q).trim();
  if (t.length < 2) return [];
  return CONCEPTS.filter(c =>
    sansAccents(c.terme).includes(t)
    || (c.alias || []).some(a => sansAccents(a).includes(t))
    || sansAccents(c.definition).includes(t));
}

/**
 * Sélectionne les concepts utiles à une analyse.
 *
 * C'est le point clé : on n'injecte pas les 30 définitions à chaque fois (le
 * modèle se noierait), seulement celles que le marché du moment convoque —
 * détectées dans le texte de l'analyse (règles déclenchées, contexte, termes
 * employés) ou explicitement demandées.
 */
function pourAnalyse(texte, max = 8) {
  const t = sansAccents(texte);
  const scores = CONCEPTS.map(c => {
    let score = 0;
    if (sansAccents(c.terme.split('—')[0]).trim() && t.includes(sansAccents(c.terme.split('—')[0]).trim())) score += 3;
    for (const a of c.alias || []) if (a.length > 2 && t.includes(sansAccents(a))) score += 2;
    if (sansAccents(c.definition) && t.includes(sansAccents(c.categorie))) score += 1;
    return { c, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

  return scores.slice(0, max).map(x => x.c);
}

/** Version texte, prête à être injectée dans une consigne d'analyse. */
function pourConsigne(texte, max = 8) {
  const sel = pourAnalyse(texte, max);
  if (!sel.length) return '';
  return sel.map(c =>
    `• ${c.terme} : ${c.definition}`
    + (c.identification && c.identification.length ? ` Repérage : ${c.identification[0]}` : '')
    + (c.pieges && c.pieges.length ? ` Piège : ${c.pieges[0]}` : '')
  ).join('\n');
}

module.exports = { CONCEPTS, CATEGORIES, CATEGORIE_IDS, tous, chercher, pourAnalyse, pourConsigne };
