# Kronos (NeoQuasar) — étude et intégration à 5trade

Source : https://github.com/shiyu-coder/Kronos (branche `master`, licence MIT),
papier arXiv 2508.02739. Vérifié en lisant le dépôt, pas de mémoire.

## Ce que c'est

Un **modèle de fondation pour les bougies K-line**, pas un indicateur de plus :
un Transformer décodeur entraîné sur des séquences OHLCV, avec un tokenizer à
deux étages qui quantifie le continu (prix, volume) en tokens discrets
hiérarchiques (bits `s1` puis `s2`). On lui donne N bougies passées, il
**génère** les M suivantes, token par token (autoregressif), avec échantillonnage
(`T`, `top_p`, `top_k`).

## Zoo de modèles (ce qui est réellement ouvert)

| modèle | tokenizer | contexte | paramètres | ouvert |
|---|---|---|---|---|
| Kronos-mini | Kronos-Tokenizer-2k | 2048 | 4,1 M | oui |
| Kronos-small | Kronos-Tokenizer-base | 512 | 24,7 M | oui |
| Kronos-base | Kronos-Tokenizer-base | 512 | 102,3 M | oui |
| Kronos-large | Kronos-Tokenizer-base | 512 | 499,2 M | **non** |

Téléchargements HF constatés : `Kronos-Tokenizer-base` 3,3 M, `Kronos-small`
2,1 M, `Kronos-base` 0,77 M, `Kronos-mini` 0,48 M. Aucune inférence hébergée
officielle : le modèle n'est pas un pipeline `transformers` standard, il faut
l'exécuter soi-même.

## API réelle (lue dans `model/kronos.py`)

    tokenizer = KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base")
    model     = Kronos.from_pretrained("NeoQuasar/Kronos-small")
    predictor = KronosPredictor(model, tokenizer, device=None, max_context=512, clip=5)

    predictor.predict(df, x_timestamp, y_timestamp, pred_len,
                      T=1.0, top_k=0, top_p=0.9, sample_count=1, verbose=True)
    predictor.predict_batch(df_list, x_ts_list, y_ts_list, pred_len, …)

- Entrée : DataFrame `open, high, low, close` (+ `volume`, `amount` optionnels —
  remplis à 0 sinon, il existe un exemple dédié `prediction_wo_vol_example.py`).
- Le temps est encodé par `calc_time_stamps` : minute, heure, jour de semaine,
  jour, mois. Donc **des timestamps obligatoires**, pas juste un index.
- Normalisation par moyenne/écart-types internes, puis `clip=5` ; dé-normalisation
  en sortie. Sortie : DataFrame avec `open, high, low, close, volume, amount`.
- `sample_count > 1` : plusieurs échantillons moyennés (coût × sample_count).
- `max_context` 512 (small/base) : au-delà, l'entrée est tronquée silencieusement.

## Coût d'inférence

Génération autoregressive → la latence croît avec `pred_len`, pas seulement avec
la taille du modèle. C'est du PyTorch : **impossible de le faire tourner dans
l'allocation gratuite de l'hébergeur** (0,5 vCPU / 1 Gio). Le service doit vivre
à côté (machine locale, VPS, ou GPU).

## Fine-tuning (le vrai levier pour tes instruments)

Deux pipelines fournis :

- `finetune/` : via **Qlib** (marché A, journalier) — lourd, peu adapté ici.
- `finetune_csv/` : CSV simple, **c'est celui qui nous concerne**. Colonnes
  exigées : `timestamps, open, high, low, close, volume, amount` (volume/amount
  peuvent valoir 0). Deux étapes : tokenizer puis predictor, via `torchrun`.
  Config YAML unique (`finetune_csv/configs/config_ali09988_candle-5min.yaml`).
  Nos `data/market-cache.json` (Deriv R_75/BOOM, Binance BTC) se convertissent
  directement en ce CSV.

Le README prévient lui-même : *« not a production-ready quantitative trading
system »*. Le finetuning améliore l'ajustement au domaine, il ne crée pas un
avantage par magie.

## Ce que ça ne fait pas

- Aucune donnée exogène : ni news, ni funding, ni carnet d'ordres, ni calendrier.
- Sur les **indices synthétiques Deriv** (R_75, BOOM500), le volume est à 0 et le
  processus est engendré par le broker : une prévision de trajectoire y est *a
  priori* sans valeur prédictive. Rien ne remplace une mesure.
- Contexte 512 : au-delà, il ne « voit » pas plus loin, il tronque.
- Ce n'est pas un signal : c'est une distribution de trajectoires possibles.

## Intégration à 5trade — architecture retenue

5trade (Node) ne peut pas héberger PyTorch. On ajoute un **micro-service Python**
à côté, et l'app le consulte en HTTP avec dégradation propre :

    navigateur ──▶ 5trade (Node, Hostless)  ──HTTP──▶  kronos-service (Python)
                              │                         ├ chargé une fois au démarrage
                              └─ /api/kronos/prevoir     └ POST /prevoir {bougies, pred_len}

- `api/kronos.js` : client. `KRONOS_URL` vide = désactivé ; service absent, lent
  ou en erreur → `null`, et l'analyse continue. Même philosophie que le secours
  NVIDIA : une dépendance optionnelle ne casse jamais le cœur.
- `GET /api/kronos/sante` : état (modèle, device, temps de chargement).
- `POST /api/kronos/prevoir` : `{symbole, timeframe, predLen}` → bougies via
  `Market.getCandles`, puis prévision. 503 explicite si le service est éteint.
- `service/app.py` : zéro dépendance web (`http.server`), modèle chargé une fois,
  appels sérialisés par un verrou (une inférence à la fois).

Lancement local :

    cd ~/kronos-stud/app && .venv/Scripts/python.exe ../service/app.py --port 8077 --modele mini
    KRONOS_URL=http://127.0.0.1:8077 npm --prefix api start

## Avant d'en faire un signal : la validation

Trois garde-fous, non négociables :

1. **Mesure walk-forward** sur données réelles : direction correcte (DA), et
   surtout R-multiple net de frais, comparé à une baseline bête (EMA cross,
   always-long). Un modèle qui bat la baseline en DA mais pas en R ne sert à rien.
2. **Jamais seul** : Kronos entre comme *une* feature (biais, amplitude, accord
   avec la structure du marché), avec un poids, et il doit pouvoir être ignoré.
3. **Parler en probabilité dans l'UI**, pas en certitude : « trajectoire médiane
   +X %, dispersion Y », jamais « ça va monter ».

Tant que (1) n'est pas fait sur ses propres instruments, Kronos reste un
**outil d'exploration** branché en lecture seule, pas un générateur de signaux.

## Décision recommandée

- Phase 1 (faite ici) : micro-service + client + endpoints, dégradation propre.
- Phase 2 : mesure walk-forward sur `data/market-cache.json` (R_75 15m/1h,
  BTCUSDT 5m) — verdict chiffré avant tout branchement dans les signaux.
- Phase 3, seulement si la mesure tient : finetuning CSV sur les séries qui
  montrent un signal, puis pondération dans `signalScoring`.
