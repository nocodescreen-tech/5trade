# Validation sur marchés réels — 2 ans, 3 marchés, coûts, DSR, PBO

Ce document ne contient aucun chiffre de simulation sur instrument synthétique.
Les trois séries viennent de Yahoo Finance (or COMEX, EURUSD, BTC-USD), du
2024-10-23 au 2026-10-23, et le moteur est rejoué bougie par bougie avec les frais.

Reproduire :

```bash
node tools/valider-reel.js "GC=F"     1h 3
node tools/valider-reel.js "EURUSD=X" 1h 3
node tools/valider-reel.js "BTC-USD"  1h 4
node tools/test-be-reel.js            # la décomposition de la convention BE
```

## Les trois chiffres qui manquaient

| Chiffre | Question | Où |
|---|---|---|
| **PSR** | Probabilité que le Sharpe réel dépasse un seuil, à taille d'échantillon et non-normalité données | `api/validite.js` |
| **DSR** | Le même, seuil relevé par le nombre d'essais : chercher le meilleur de N garantit un bon Sharpe sans compétence | idem |
| **PBO** | Fréquence à laquelle la meilleure configuration en apprentissage passe sous la médiane hors échantillon (CSCV) | idem |

## Résultats

### BTC-USD 1h — 17 332 bougies, 8 329 trades, 7 concepts

| concept | n | espérance | IS | OOS | Sharpe | PSR | coûts ×2 |
|---|---|---|---|---|---|---|---|
| Breaker | 846 | +0,234 R | +0,179 | +0,319 | 0,149 | 0,999 | survit (0,983) |
| FVG | 675 | +0,222 R | +0,231 | +0,205 | 0,161 | 0,999 | survit (0,998) |
| graphique | 3 169 | +0,170 R | +0,224 | +0,091 | 0,106 | 0,999 | survit (0,979) |
| Order block | 387 | +0,138 R | +0,151 | +0,119 | 0,101 | 0,845 | non |
| bougie | 1 418 | +0,119 R | +0,095 | +0,154 | 0,086 | 0,912 | non |
| Structure | 1 254 | +0,078 R | +0,086 | +0,065 | 0,068 | 0,733 | non |
| Liquidité | 580 | +0,067 R | +0,057 | +0,081 | 0,052 | 0,508 | non |

**PBO 7,9 %** · tous les concepts positifs · positifs dans les deux moitiés de la
période · **3 sur 7 survivent au Deflated Sharpe** · ils survivent aussi à des
coûts doublés.

### GC=F (or COMEX) 1h — 11 494 bougies, 6 347 trades, 7 concepts

Espérance **+0,0883 R** · PBO **84,9 %** · **0 sur 7** ne survit au DSR ·
coûts doublés : **−23 %** (l'avantage résiste).

### EURUSD 1h — 12 351 bougies, 2 506 trades

Espérance **+0,0770 R** au spread nominal, le concept « graphique » atteint
PSR 0,998. **Coûts doublés : +0,0156 R, soit −80 %**, et plus aucun concept ne
survit. Signature d'un avantage qui n'existe qu'à friction quasi nulle.

## Le test qui change la conclusion : la convention BE

Un « BE » (objectif 1 pris, retour à l'entrée) est crédité de la moitié du premier
objectif. Sa part dans le résultat total :

| marché | total avec BE | dont BE | total si BE = 0 |
|---|---|---|---|
| BTC-USD | +1 246,15 R (**+0,1496**/trade) | 885,51 R = **71 %** | +360,64 R (**+0,0433**) |
| GC=F | +560,61 R (**+0,0883**/trade) | 777,44 R = **139 %** | −216,83 R (**−0,0342**) |

Sur l'or, retirer la convention **change le signe** : l'avantage affiché est
entièrement fabriqué par une hypothèse de gestion. La littérature le dit (FX
Terminal : « break-even stops usually lower expectancy… pays only when losers
rescued exceed R times winners scratched »), la mesure le confirme.

Décomposition par concept, BTC, sans la convention :

| concept | avec BE | sans BE |
|---|---|---|
| Breaker | +0,235 R (PSR 0,999) | **+0,115 R** (PSR 0,768) |
| FVG | +0,222 R (PSR 0,999) | **+0,108 R** (PSR 0,782) |
| graphique | +0,170 R (PSR 0,999) | +0,059 R (PSR 0,230) |
| Structure | +0,078 R | −0,008 R |
| Liquidité | +0,067 R | −0,031 R |

## Verdict

1. **Sur instrument synthétique (R_75), tout résultat est sans valeur.** La
   validation a été refaite sur des marchés réels ; c'est la seule qui compte.
2. **L'or et l'EURUSD n'ont pas d'avantage défendable.** L'or est positif
   uniquement grâce à la convention BE (−0,034 R sans elle) ; l'EURUSD meurt dès
   que les coûts doublent (−80 %). Ni l'un ni l'autre ne doit être annoncé.
3. **BTC présente un avantage réel mais non encore établi** : Breaker **+0,115 R**
   et FVG **+0,108 R** par trade sur 8 329 trades et 2 ans, frais inclus, positifs
   dans les deux moitiés de la période, robustes à des coûts doublés. Le PSR de
   0,77 reste **sous la barre de 0,95** : l'avantage est probable, pas démontré.
4. **La convention BE doit cesser d'être la présentation par défaut.** Elle
   fabrique 71 % du résultat BTC et 139 % de celui de l'or. Tant qu'elle est la
   ligne du haut, le système affiche une performance de gestion, pas de méthode.

## Ce qu'il faut faire ensuite, dans cet ordre

| # | Action | Pourquoi |
|---|---|---|
| 1 | Passer la convention BE à **zéro par défaut** dans le moteur, la garder en option | Elle décide du signe des résultats : elle ne peut pas être l'hypothèse implicite |
| 2 | Ne valider et n'afficher que **BTC 1h, Breaker + FVG** | Seule combinaison qui survit aux coûts, aux deux moitiés, et au DSR |
| 3 | Chercher **plus d'historique BTC** (5 ans, 5m) | PSR 0,77 avec 2 ans : il faut ~2 500 trades de plus pour trancher |
| 4 | Ajouter un **slippage** dépendant de la taille | Le remplissage au niveau exact reste l'hypothèse la plus optimiste |
| 5 | Paper trading BTC 1h sur les deux concepts retenus | Confronter le simulé au réel, seul juge final |
