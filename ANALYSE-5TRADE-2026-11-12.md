# 5TRADE — analyse mesurée

Date : 12 novembre 2026
Dépôt : `nocodescreen-tech/5trade`, branche `main`, commit `3001cb0`
Méthode : chaque chiffre ci-dessous sort d'une commande exécutée sur le dépôt ou la base,
pas d'une lecture de code. Les limites sont nommées avec la même précision que les progrès.

---

## 1. État vérifiable

| Élément | Valeur mesurée |
| --- | --- |
| Tests (`npm run test`) | 1 288 réussis, 0 échoué, code 0 |
| Serveur | `http://127.0.0.1:3001` — page 200, `/healthz` ok |
| Base | PostgreSQL, 14 953 évaluations de stratégie |
| Surveillance | active, 8 stratégies, 5 marchés, cycle de 60 s |
| IA | NVIDIA NIM, 4 modèles en cascade |

---

## 2. Chaîne de décision

Ce qui BLOQUE désormais, et qui ne bloquait pas avant :

| Garde | Comportement mesuré |
| --- | --- |
| Validation → confirmation → exécution | Le verdict de chaque niveau est transmis au suivant. Un signal rejeté en validation ne peut plus être confirmé (mesure : décision ACHAT avec 0 confirmation et 1 exécutable avant correctif, impossible depuis). |
| Filtre obligatoire absent | « Non évalué » vaut « non rempli ». Avant, un filtre jamais calculé passait pour satisfait. |
| Alignement MTF | Exigé et données absentes = condition non vérifiable, donc bloquante. |
| Direction inconnue | Interdit l'exécution. `UNKNOWN` n'est plus rabattu sur `NEUTRAL`. |
| Risque en erreur | Renvoie `ATTENTE`. Avant : `decision: null`, qui laissait survivre un ACHAT. |
| Conflit entre stratégies | Publié (achats, ventes, forces, écart, tranché ou non) au lieu d'être résolu en silence. |
| Journal | Écrit après TOUS les filtres, et seulement pour les signaux retenus exécutables. |

---

## 3. Direction et décision, mesurées en base

Sur 14 953 évaluations :

| Direction | Nombre |
| --- | --- |
| BUY | 6 520 |
| SELL | 5 029 |
| `null` (historique, avant correctif) | 3 229 |
| NEUTRAL | 175 |

| Décision | Nombre |
| --- | --- |
| WAITING | 13 127 |
| VALID | 1 826 |

Aucune valeur `UNKNOWN` n'apparaît encore : le correctif est récent, et les lignes `null`
sont antérieures. Elles resteront lisibles comme UNKNOWN à l'écran, pas comme une absence.

---

## 4. Instruments et fournisseurs

Huit cas exigés, exécutés sur le code réel :

| Symbole | Classe | Base/cote | Verdict |
| --- | --- | --- | --- |
| `frxEURUSD` | forex | EUR/USD | correct |
| `frxGBPJPY` | forex | GBP/JPY | correct |
| `frxUSDJPY` | forex | USD/JPY | correct |
| `BTCUSDT` | crypto | — | correct |
| `R_75` | synthétique | — | correct |
| `frxXAUUSD` | métaux | —/USD | correct |
| `EURUSDT` | crypto, **proxy de EURUSD** | — | n'est plus pris pour la paire Forex |
| `ZZZINCONNU` | inconnu | — | refusé, pas deviné |

Contrôles de cohérence : `EURUSDX` et `EURXUSD` sont refusés (caractère résiduel),
`EUREUR` refusé (base = cote), `R_75` annoncé « forex » par le fournisseur produit une
incertitude au lieu d'une classification arbitraire.

Routage : `R_75@deriv` accepté ; `R_75@binance`, `R_75@nexistepas` et `BTCUSDT@deriv`
refusés avec le motif réel. Plus de substitution silencieuse.

---

## 5. Calendrier économique et dépêches

Le parseur du calendrier était **cassé à 100 %** : six groupes capturés pour sept variables,
donc `previous` valait `undefined` et `.trim()` levait sur chaque événement. Le filtre
économique ne pouvait jamais bloquer quoi que ce soit, tout en donnant l'impression d'être actif.

Après correction, mesuré :

| Paire | Verdict |
| --- | --- |
| `frxEURUSD` | « calendrier vérifié pour EUR et USD : aucune annonce imminente » |
| `R_75` | non applicable (indice synthétique, aucune devise) |
| annonce du lendemain | ne bloque plus la paire aujourd'hui (date + heure comparées en UTC) |

Cinq dépêches soumises à l'IA, sens connus :

| Dépêche | Direction | Actifs |
| --- | --- | --- |
| Baisse de taux Fed 50 pb | VENTE | USD — opposés : XAU, US30, NAS100, SPX500 |
| ETF bitcoin approuvé | ACHAT | BTC, ETH |
| Piratage d'exchange | VENTE | BTC, ETH |
| Résultats conformes | NEUTRAL | aucun |
| Hausse surprise BCE | ACHAT | EUR — opposés : XAU, GER40 |

Le cas « résultats conformes » ne produit aucun actif : l'IA n'invente pas de direction.
Le champ `opposes` existe parce qu'une baisse de taux fait baisser l'USD **et** monter l'or :
un seul sens pour plusieurs actifs était nécessairement faux.

---

## 6. Journal et performance — le point le plus dérangeant

| Mesure | Valeur |
| --- | --- |
| Signaux enregistrés | 800 |
| Trades avec un R calculé | 778 |
| Gagnants | 234 |
| Perdants | 373 |
| Taux de réussite | 30,1 % |
| Somme des R | **+44,82 R** |
| Espérance par trade | +0,058 R |
| Meilleur / pire | +4,01 / −5,15 |
| Signaux avec frais renseignés | **0 / 800** |

Le `+44,82 R` est **brut**. Aucun signal ne porte de frais : ni spread, ni commission, ni
glissement. Ce chiffre ne survit pas à la déduction des coûts et ne doit pas être présenté
comme un résultat net. Un écart existe entre cette mesure (800 signaux, 30,1 %) et l'export
précédent (779 signaux, 42,2 %) : la définition du gagnant diffère selon que les trades
plats sont comptés ou non, et le journal a grossi entre-temps. À trancher explicitement.

---

## 7. Fiches stratégie

| Mesure | Valeur |
| --- | --- |
| Fiches évaluables | 12 / 12 |
| Fiches signalées « partiel » | 5 |
| Règles disponibles dans le moteur | R1 balayage, R2 structure, R3 zone, R4 range, R7 déplacement, R8 extension |

Le point important : `strategy_reversal` et `strategy_trend` produisaient **la même règle
unique R2**, donc le même BUY sur EURUSD. Leurs profils ne différaient que par leur `id` et
leur titre. Leur condition principale — moyenne mobile 50/200 pour l'une, divergence RSI pour
l'autre — n'existe dans aucune règle du moteur. Elles restent évaluables sur ce qu'elles
partagent (la structure), avec un avertissement explicite au lieu d'une désactivation.

---

## 8. Ce qui reste ouvert

Ces points ne sont pas corrigés, et les présenter comme réglés serait faux.

| Sujet | État |
| --- | --- |
| Backtest ≠ direct | Le backtest appelle `detecterTout` sans rejouer la chaîne complète de décision, et accepte les signaux `surveiller`. Ses statistiques ne sont pas celles du direct. |
| Flux WebSocket | Un seul état global `(provider, timeframe)`. Trois souscriptions hétérogènes se remplacent au lieu de coexister ; le repli REST annoncé n'est pas déclenché. |
| Portefeuille | Deux mécanismes distincts (trades manuels, journal des signaux) avec deux capitaux de référence (10 000 et 1 000). Pas de registre canonique unique. |
| Calibration par instrument | La structure existe (`calibration.js`, résolution instrument > famille > classe) mais le registre est **vide** : aucune valeur n'est inventée. |
| Cycle de vie des zones | `NOT_RETURNED`, `APPROACHING`, `IN_ZONE`, `REJECTED`, `BROKEN`, `EXPIRED` ne sont pas modélisés : le moteur détecte un état, pas un trajet du prix. |
| CRT / QML | Absents du code et des fiches. Définitions non fournies. |
| Frais | Aucun coût configuré. Le mode strict existe (`verifierFrais: 'strict'`) mais n'est pas activé : l'activer sans renseigner les coûts bloquerait toute exécution. |
| Bougies figées | Signalées dans l'export précédent (58-59 h). Non reproduites ici : la base écrit à chaque cycle. À réexaminer si le symptôme revient. |

---

## 9. Verdict

**Prouvé par exécution** : le chaînage des niveaux, le blocage sur risque en erreur,
l'identification des huit instruments, le refus des proxys et des fournisseurs incompatibles,
la réparation du calendrier, la distinction direction / décision, le refus d'un coût inconnu
lu comme nul, l'ordre TP1/TP2, la garde SSRF, la protection des uploads, le retrait de
l'abonnement Push du dépôt.

**Non prouvé** : la rentabilité. 30,1 % de réussite et +44,82 R brut, sans un seul frais
renseigné, ne démontrent aucun avantage exploitable. Tant que les coûts réels ne sont pas
saisis et que le backtest ne rejoue pas la chaîne du direct, les performances affichées
restent une hypothèse.

L'ordre de travail qui découle de ces mesures : frais réels, puis backtest aligné sur le
direct, puis registre de portefeuille unique. Les stratégies viennent après — il n'y a pas
de sens à en ajouter avant que ces trois points tiennent.
