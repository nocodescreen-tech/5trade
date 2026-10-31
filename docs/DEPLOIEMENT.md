# Déployer 5trade n'importe où

La même image sert partout. Ce qui change d'une plateforme à l'autre : le nom,
la région, la façon dont la base arrive dans `DATABASE_URL`, et l'endroit du
volume. Rien d'autre.

    docker build -t fivetrade .
    docker run -p 3001:3001 --env-file .env -v fivetrade-state:/app/state fivetrade

Contrôle avant de lancer un build (30 s au lieu de 5 min perdues) :

    node tools/preflight-deploy.js <render|koyeb|hostless|northflank|fly|vps>
    node tools/preflight-deploy.js hostless --url https://ton-app.code.run

## Ce que l'image attend

| variable | rôle | défaut |
|---|---|---|
| `PORT` | port d'écoute | 3001 |
| `HOST` | interface d'écoute | 0.0.0.0 en prod |
| `DATABASE_URL` | PostgreSQL — **obligatoire en production** | — |
| `DATA_DIR` | journal, coûts, lexique, comptes (repli JSON) | /app/state/data |
| `KNOWLEDGE_BASE_DIR` | stratégies importées, concepts, documents | /app/state/knowledge-base |
| `UPLOADS_DIR` | captures et fichiers envoyés | /app/state/uploads |
| `DEEPSEEK_API_KEY` | IA payante | — |
| `NVIDIA_API_KEY` | secours IA **gratuit**, bascule automatique | — |
| `GEMINI_API_KEY` | lecture des captures | — |
| `SMTP_*` | OTP d'inscription | — |

Liste complète, commentée : `.env.deploy.example`. Aucun `.env` n'est versionné
ni inclus dans l'image.

Santé : `GET /healthz` → `{"ok":true,"stockage":"postgresql",...}` ; il touche
réellement la base, donc un 503 signale une vraie panne (pas un proxy capricieux).

## Render

1. `render.yaml` est à la racine : New > Blueprint > ce dépôt.
2. Render crée le service **et** la base, et injecte `DATABASE_URL`.
3. Saisir les secrets (`sync: false`) dans Environment.

Limites du plan gratuit, mesurées sur leur documentation : le service s'endort
après ~15 min d'inactivité (premier appel ~50 s), **pas de disque persistant**
(`/app/state` repart vide à chaque déploiement — l'entrypoint y recopie les
graines), et la base gratuite expire au bout de 30 jours. Les données qui doivent
survivre (comptes, trades, stratégies) sont en PostgreSQL.

## Koyeb

1. Créer l'app depuis le dépôt GitHub : Koyeb détecte le `Dockerfile`.
2. Ajouter une base PostgreSQL Koyeb, copier sa chaîne dans `DATABASE_URL`.
3. Mettre les autres variables (`.env.deploy.example`).
4. Health check : HTTP `/healthz`. Volume : monter sur `/app/state`.

Koyeb injecte son propre `PORT` : l'image lit `process.env.PORT`, rien à faire.

## Hostless Cloud

1. New app > GitHub > le `Dockerfile` est détecté (« Deploy Docker apps from a
   Dockerfile or a detected build »).
2. Base PostgreSQL managée dans le même projet → sa chaîne dans `DATABASE_URL`.
3. Variables d'environnement : les clés de `.env.deploy.example`.

Leur plan gratuit n'exige **pas de carte**, ne met **pas** les apps en veille, et
mutualise 0,5 vCPU / 1 Gio de RAM / 512 Mio de base entre les projets. Au-delà :
0,03 $/vCPU-heure. C'est la cible la plus proche de « gratuit qui tient debout »,
et la seule essayée ici qui n'impose pas de moyen de paiement.

## Northflank

Fonctionne, mais **un moyen de paiement par défaut est exigé avant toute
création de service**, même sur le plan gratuit (« Please complete your account
by adding a default payment method »). Une fois la carte enregistrée :

    NF_TOKEN=... node tools/northflank-deploy.js

Contraintes déjà encodées dans le script : nom commençant par une lettre
(`5trade` refusé → `fivetrade`), `region` obligatoire, description ASCII.

## Fly.io / VPS Docker

    fly launch --dockerfile Dockerfile --no-deploy
    fly volumes create etat --size 1
    fly secrets set DATABASE_URL=... DEEPSEEK_API_KEY=... NVIDIA_API_KEY=...
    fly deploy

VPS : `docker run -d -p 3001:3001 --env-file .env -v fivetrade-state:/app/state
fivetrade`, derrière nginx/Caddy en `proxy_pass http://127.0.0.1:3001`.

## Récupérer les données locales

Fichiers (stratégies importées, lexique, alertes) : l'entrypoint les copie dans
le volume au premier démarrage, depuis les graines de l'image.

Base (comptes, trades, sessions) :

    NF_DATABASE_URL='postgresql://…' bash tools/migrer-db-vers-northflank.sh

Le script marche pour n'importe quelle base cible (Render, Koyeb, Hostless) :
c'est un `pg_dump` local restauré à distance.
