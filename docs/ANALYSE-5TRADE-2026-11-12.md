# 5TRADE — analyse complète (12/11/2026)

Analyse menée sur le dépôt `nocodescreen-tech/5trade`, serveur local `:3001`,
frontend `frontend/index.html`. Toutes les affirmations ci-dessous ont été
mesurées ou lues dans le code ; rien n'est déduit de l'apparence.

## 0. Ce qui n'a pas pu être fait, et pourquoi

L'application n'expose qu'**un seul compte** (`DB.getAccount()`, id `owner`) et
l'inscription est refusée dès qu'un compte vérifié existe :

```
POST /api/signup -> 409 "Une inscription est déjà enregistrée pour cette plateforme."
```

Je n'ai donc **pas** pu capturer les écrans authentifiés (dashboard, analyse,
journal, stratégies). Ce qui a été capturé : écran de connexion
(`shots/ui-motion-login.png`, `shots/ui-motion-reduced.png`) et les mesures de
chargement. **Toute analyse visuelle du dashboard reste à faire avec un accès.**

`prototype-redesign.html` n'est pas servi par le serveur (délai dépassé sur
`/prototype-redesign.html`) : c'est un artefact mort dans le dépôt.

## 1. Nature réelle du produit

5trade est un **outil d'aide à la décision**, pas un système de trading.

Preuve : aucune intégration courtier, aucune table d'ordres ni de positions.
Les seules occurrences de « broker / execution / placeOrder / MT5 / Binance »
sont internes au moteur (`DecisionEngine.js`, `signals.js`,
`instrument-classifier.js`). Le produit produit un **signal** et une **décision**
(ENTRER / ATTENDRE / refus motivé), que l'humain exécute ailleurs.

C'est un choix défendable — mais il rend la comparaison avec un système de
trading réel structurellement inégale, et c'est le point le plus important de
cette analyse : **on ne compare pas un moteur de décision à un OMS.**

## 2. Comparaison avec un système de trading réel

| Dimension | Système réel (OMS/EMS) | 5trade aujourd'hui |
|---|---|---|
| Exécution | Envoi d'ordres au courtier (FIX/REST), accusés, rejets, fills partiels | **Absent** — décision seulement |
| Positions | Positions ouvertes, P&L latent/réalisé, marge, swaps | **Absent** — journal de trades clos |
| Idempotence | Chaque ordre porte un `clientOrderId`, rejeu sûr | Sans objet (pas d'ordre) |
| Réconciliation | Position broker vs position interne, écarts alertés | **Absent** |
| Latence | tick → ordre < 100 ms | **10,3 s** pour afficher l'écran |
| Risque | Limites pré-trade **bloquantes côté serveur**, kill switch | Étage risque présent, mais la décision ne peut pas bloquer une exécution qu'il ne fait pas |
| Données de marché | Flux licencié L1/L2, horodatage exchange | Bougies REST de sources publiques |
| Audit | Journal d'ordres immuable, rétention réglementaire | Journal applicatif + sauvegardes compressées (vérifiées) |
| Backtest | Walk-forward, coûts, slippage, biais de sélection | **Bon** : IS/OOS, DSR/PBO, frais modélisés (234 occurrences spread/commission/slippage) |
| Multi-utilisateur | Comptes, rôles, permissions | **Un seul compte**, pas de rôles |

Ce que 5trade fait **mieux** que beaucoup d'outils amateurs : il refuse de
présenter un chiffre non vérifié (calibration 70/30, IS>0, OOS>2,5×IS signalé
comme instable), il modélise les frais, et l'absence de vérification de risque
mène à `ATTENTE` et non à une autorisation implicite.

## 3. Bugs et erreurs vérifiés

### 3.1 Critique — la page met 10 secondes à s'afficher

Mesuré au navigateur, sur localhost, cache vide :

```
DOMContentLoaded        5 821 ms
load                    7 878 ms
réseau au repos (idle) 10 297 ms
babel.min.js              533 Ko transférés (2,9 Mo sur disque)
tailwind.js               121 Ko
react-dom                  43 Ko
```

Cause : **Babel compile 450 Ko de JSX dans le navigateur à chaque chargement**
(`<script type="text/babel">` sur un fichier de 370 Ko). C'est un outil de
développement laissé en production. Sur téléphone en 4G, c'est plusieurs
dizaines de secondes, et le CPU du téléphone chauffe pendant la compilation.

Correctif : précompiler le JSX (esbuild/Vite, un seul fichier `app.js` minifié),
supprimer `babel.min.js` du chemin critique. Attendu : < 1,5 s.

### 3.2 Élevé — limitation de tentatives inopérante derrière un proxy

```js
function rateLimitLogin(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'x';
  const LIMIT = process.env.NODE_ENV === 'production' ? 8 : 100;
```

Trois défauts cumulés :
1. **`app.set('trust proxy', …)` est absent.** Derrière Render/Cloudflare,
   `req.ip` est l'IP du proxy : tous les utilisateurs partagent le même compteur.
   En production (8 essais), **huit échecs de n'importe qui bloquent tout le
   monde** pendant 10 minutes.
2. Compteur **en mémoire** : remis à zéro à chaque redémarrage, non partagé
   entre instances.
3. `req.connection` est déprécié.

### 3.3 Élevé — cookie de session sans `Secure`

```js
`s5_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=…`
```

`HttpOnly` et `SameSite=Strict` sont bons. Mais **pas de `Secure`** : le cookie
peut être transmis en clair si une requête part en HTTP, et il n'y a pas de
préfixe `__Host-`. Sur un déploiement HTTPS public, c'est une régression
gratuite à corriger.

### 3.4 Moyen — hachage de mot de passe bloquant

`crypto.scryptSync(...)` : primitive correcte (sel aléatoire 16 octets, 64 octets
de sortie), mais **synchrone** — elle bloque la boucle d'événements à chaque
connexion. Sur un serveur à faible CPU, quelques connexions simultanées suffisent
à geler l'API. Utiliser `crypto.scrypt` (asynchrone).

### 3.5 Moyen — 6 tests en échec

```
npm run test -> 1214 réussis · 6 échoués · 1 non testé
```

Les six concernent le moteur de décision :
`NO_TRADE` là où le test attend un trade exécutable, et vérificateur de risque
qui ne renvoie rien. Cause identifiée : `api/engine/DecisionEngine.js` est
**modifié et non committé** (33 lignes ajoutées : blocage si l'alignement MTF est
exigé sans données, refus si le vérificateur renvoie une réponse vide).
Idem `api/delivery/scan.js` et `api/sources/market.js` — 83 lignes au total,
non committées. Le dépôt n'est donc pas dans un état vert reproductible.

### 3.6 Moyen — monolithe serveur

`api/server.js` : **106 routes** dans un seul fichier de plus de 3 000 lignes,
sessions, OTP, emails, Cloudinary, trading et exports mélangés. Toute évolution
touche un fichier unique ; les tests d'intégration doivent démarrer le serveur
complet.

### 3.7 Faible — frontend sans tests et sans build

42 composants dans un unique `index.html` de 370 Ko, zéro test frontend, zéro
étape de compilation. Les tests backend lisent le source pour vérifier certains
comportements d'écran (fragile : un renommage casse le test sans casser
l'écran).

### 3.8 Faible — artefact mort

`frontend/prototype-redesign.html` n'est pas servi. Soit on le branche, soit on
le supprime.

## 4. Points solides (à ne pas casser)

- **OTP 6 chiffres, haché, à usage unique, anti-bruteforce** — vérifié dans le
  code, et annoncé honnêtement dans l'interface.
- **Sauvegarde réellement testée** : « restauration réelle dans une base
  jetable : comptes identiques — 7/31/2 → 7/31/2 ».
- **Honnêteté des chiffres** : une combinaison sous 10 trades tranchés est
  marquée non fiable ; un vérificateur en panne ne vaut ni autorisation ni refus.
- **Reprise réseau** sur Telegram et Gemini (3 tentatives, 400 non réessayé).
- **Secrets** : jeton Telegram lu depuis l'environnement, jamais divulgué dans le
  diagnostic.
- **Couche mouvement** : tokens unifiés, `transform`/`opacity` seulement,
  `prefers-reduced-motion` vérifié au navigateur (animations coupées, contenu
  visible).

## 5. Ordre de priorité suggéré

1. **Précompiler le frontend** (10 s → < 1,5 s). Effet immédiat sur tous les
   utilisateurs, aucun risque fonctionnel.
2. **`trust proxy` + limiteur partagé** (Redis ou compteur en base) — sinon la
   protection contre le bruteforce devient un déni de service.
3. **`Secure` sur le cookie** de session.
4. **Committer ou annuler** les trois fichiers backend en cours : tant qu'ils
   sont sales, `npm run test` n'est pas vert et personne ne sait si la base est
   saine.
5. **`scrypt` asynchrone**.
6. Décider explicitement du positionnement : outil d'aide à la décision
   (assumé, documenté) ou ambition d'exécution (alors il manque OMS, positions,
   réconciliation, idempotence — un chantier, pas un correctif).

## 6. Limite de cette analyse

Sans accès authentifié, je n'ai pas pu auditer : le rendu réel du dashboard, la
cohérence des chiffres affichés avec ceux du moteur, les états vides, le
comportement du graphique sous charge, ni l'ergonomie mobile. Ces points
demandent une session ouverte.
