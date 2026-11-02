# Kronos (NeoQuasar) — évalué, mesuré, écarté

Décision : **pas d'intégration à 5trade.** Le code a été retiré après mesure.
Ce document garde la trace du pourquoi, pour ne pas refaire l'essai dans six mois.

## Ce que c'était

Un modèle de fondation pour bougies K-line (arXiv 2508.02739) : tokenizer
hiérarchique (OHLCV → tokens discrets) + Transformer décodeur autoregressif qui
génère les bougies suivantes. Dépôt : github.com/shiyu-coder/Kronos (MIT).
Zoo ouvert : Kronos-mini (4,1 M params, contexte 2048), Kronos-small (24,7 M,
512), Kronos-base (102,3 M, 512). Kronos-large (499 M) n'est pas publié.

## Ce qui a été testé

Environnement : Python 3.11, torch 2.15.0+cpu, Kronos-mini + Tokenizer-2k,
sur cette machine (CPU, 4 threads).

Mesures techniques (utiles en soi) :

    installation        373 s au premier chargement (téléchargement HF), 3–15 s ensuite
    inférence           1,1–1,6 s pour 12 bougies · 2,9 s pour 24 · ~6,7 s avec 5 échantillons
    stabilité R_75 15m  +0,34 % · −0,43 % · +0,39 % · −1,88 % sur la MÊME entrée
                        (5 échantillons moyennés : +0,06 % · −1,35 % · −0,34 %)

## La mesure qui tranche

Walk-forward sur **5 000 bougies réelles** BTCUSDT 5m récupérées chez Binance,
297 origines, horizon 6 bougies, coût 5 points de base par aller-retour :

    corrélation variation prédite / réalisée :  −0,037
    Kronos-mini      207 trades · DA 48,3 % · −5,69 pb/trade · total −11,78 %
    EMA20/EMA50      297 trades · DA 47,5 % · −5,49 pb/trade · total −16,30 %

Directional accuracy sous 50 % — une pièce de monnaie fait mieux —, corrélation
nulle, espérance négative une fois les frais comptés. Il ne bat pas la baseline
la plus bête, et les deux perdent : il n'y a là aucun avantage exploitable.

Sur les indices synthétiques Deriv (R_75, BOOM), c'était pire encore : la
prévision change de sens d'une exécution à l'autre, avec une amplitude
supérieure au mouvement cherché. Attendu — ces prix sont engendrés par le
broker, il n'y a pas de structure à apprendre.

## Pourquoi ça n'a rien d'étonnant

- Un modèle pré-entraîné sur des K-lines apprend la *forme* statistique des
  séries, pas une causalité de marché. Sur 5 minutes, le bruit domine.
- Contexte 512 bougies, aucune donnée exogène (news, funding, carnet, macro).
- Le dépôt prévient lui-même : *« not a production-ready quantitative trading
  system »*.
- Le fine-tuning (pipeline `finetune_csv/`, colonnes `timestamps,open,high,low,
  close,volume,amount`) ajuste au domaine, il ne crée pas d'alpha.

## Ce qui reste, si l'idée revient

Les scripts de mesure sont hors dépôt, dans `~/kronos-stud`
(`test-kronos.py`, `measure-kronos.py`, service HTTP, venv torch). Ils
permettent de rejouer l'expérience sur une autre série ou un autre modèle sans
rien réinstaller. Le protocole à conserver : **walk-forward + baseline + frais**,
jamais une courbe jolie.
