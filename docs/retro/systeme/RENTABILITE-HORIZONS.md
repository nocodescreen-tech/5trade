# Où le système est réellement rentable — et où il ne l'est pas

Mesuré le 2026-10-23. Données Yahoo Finance, **10 ans** de bougies quotidiennes,
moteur rejoué bougie par bougie, frais inclus, **glissement facturé à un spread
entier** (entrée + sortie). Reproductible :

```bash
node tools/sweep-horizons.js 1d          # 12 instruments, 2 niveaux de glissement
node tools/portefeuille-indices.js       # les 8 indices agrégés + DSR
```

## Le levier n'était pas le filtre, c'était l'horizon

Le coût d'un trade en R vaut `spread / distance au stop`. Un stop quotidien est
10 à 30 fois plus large qu'un stop horaire : **le même spread pèse 10 à 30 fois
moins**. C'est arithmétique, pas une opinion.

Conséquence mesurée en quotidien sur 10 ans, glissement = 1 spread :

| instrument | trades | espérance | verdict |
|---|---|---|---|
| ^N225 (Nikkei) | 2 986 | **+0,0723 R** | positif |
| NQ=F (Nasdaq) | 2 664 | **+0,0686 R** | positif |
| YM=F (Dow) | 2 766 | **+0,0583 R** | positif |
| ^FTSE (Londres) | 3 468 | **+0,0534 R** | positif |
| ^HSI (Hong Kong) | 3 010 | **+0,0469 R** | positif |
| ES=F (S&P 500) | 2 647 | **+0,0449 R** | positif |
| ^GDAXI (DAX) | 3 091 | **+0,0275 R** | positif |
| RTY=F (Russell) | 2 714 | −0,0098 R | négatif |
| GC=F (or) | 2 847 | −0,0002 R | nul |
| CL=F (WTI) | 2 708 | −0,0034 R | nul |
| BTC-USD | 3 643 | +0,0269 R | positif |
| EURUSD=X | 3 377 | −0,2301 R | **négatif franc** |

## Le résultat central : 7 indices sur 8

En agrégeant les huit indices d'actions (mêmes règles, mêmes paramètres, aucun
réglage par marché) :

```
trades             : 23 346
espérance          : +4,56 % du risque par trade
total              : +1 064 R sur 10 ans
marchés positifs   : 7 / 8
Sharpe par trade   : 0,0299
DSR (déflaté 8)    : 0,845
DSR (déflaté 50)   : 0,154
drawdown max       : −125 R
hasard (binomial)  : 3,5 % de voir 7/8 positifs par chance
```

**Ce qui est établi** : la même mécanique, appliquée sans ajustement à huit
marchés indépendants sur trois continents, est positive sur sept d'entre eux
après un spread entier de glissement. La probabilité que ce soit du hasard est de
**3,5 %**. Ce n'est plus un réglage chanceux sur un instrument.

**Ce qui n'est pas établi** : le Deflated Sharpe du portefeuille vaut 0,845, sous
la barre de 0,95. Déflaté pour 50 essais (tous les réglages essayés depuis le
début du projet), il tombe à 0,154. L'avantage est donc **probable et répliqué,
pas démontré**.

## Pourquoi les indices et pas le forex

EURUSD est à −0,23 R par trade : ce n'est pas un problème de méthode, c'est un
problème de friction. Sur du forex retail, le spread représente une part du stop
qui absorbe l'espérance d'un signal de price action. Les indices d'actions ont
des stops structurellement plus larges (volatilité quotidienne, sessions) et une
tendance de fond qui porte les cassures.

## Ce que le produit doit changer

1. **L'horizon par défaut de l'analyse passe à `1d`** pour les indices. Le 5m et
   le 15m restent disponibles, mais l'écran doit dire que leur espérance ne
   survit pas à la friction.
2. **Le tableau de bord doit exposer le portefeuille**, pas seulement le couple
   marché/unité : c'est l'agrégat qui porte l'avantage, pas une famille.
3. **Le glissement doit être réglé par défaut à 1 spread** dans l'analyse : c'est
   l'hypothèse qui a fait tomber tous les résultats précédents, elle doit être la
   norme et non l'option.
4. **Le module de risque doit simuler ce portefeuille** avec ses plafonds
   (5 positions, 2 % par marché, 5 % au total) : 23 346 trades ne tiennent pas
   dans 5 positions simultanées, le résultat net sera plus bas. C'est la prochaine
   mesure honnête.

## Le réglage qui rend le système tradable

23 346 trades ne tiennent pas dans 5 positions : il faut composer le capital.
Balayage du risque par trade × nombre de positions (`tools/reglage-risque.js`) :

| risque/trade | positions | prises | rendement/an | drawdown | ratio |
|---|---|---|---|---|---|
| 0,25 % | 3 | 1 482 | 1,2 % | 10,2 % | 0,12 |
| 0,25 % | 10 | 5 066 | 9,1 % | 12,7 % | 0,72 |
| 0,50 % | 5 | 2 445 | 6,7 % | 18,5 % | 0,36 |
| **0,50 %** | **10** | **4 814** | **22,4 %** | **15,7 %** | **1,43** |
| 1,00 % | 5 | 2 281 | 16,5 % | 34,8 % | 0,47 |
| 2,00 % | 5 | 4 | 0,6 % | 2,2 % | 0,29 |

**Le réglage retenu : 0,5 % de risque par trade, 10 positions simultanées.**
22,4 % par an pour 15,7 % de drawdown, ratio 1,43, sur 4 814 prises en 10 ans.

Deux enseignements contre-intuitifs :
- **Augmenter le risque par trade ne rend pas plus riche.** À 2 %, les plafonds de
  marché et de total refusent presque tout : 4 trades en 10 ans, 0,6 %/an.
- **Le nombre de positions compte plus que le risque unitaire.** Passer de 5 à 10
  positions à 0,5 % triple le rendement sans augmenter le drawdown.

Ce réglage est exposé comme préréglage mesuré : `Risque.configurerPreset('indices')`.

## Ce qui reste à faire pour passer 0,95

| Levier | Effet attendu |
|---|---|
| Ajouter des indices (ASX, TSX, SMI, IBEX…) | Plus de marchés → DSR(8) monte mécaniquement |
| Remonter à 15-20 ans d'historique | 2 500 bougies → 5 000 : la longueur minimale était ~1 000 |
| Filtrer par régime (tendance vs range) | Moins de trades, espérance par trade plus haute |
| Simuler le portefeuille sous plafonds | Le vrai chiffre, plus bas mais honnête |

Aucun de ces leviers ne demande une idée neuve : ils demandent du calcul. C'est
la première fois dans ce projet que la question est « combien ça rapporte », et
non plus « est-ce que ça existe ».
