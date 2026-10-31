#!/bin/sh
# 5trade — démarrage en conteneur.
# Le volume persistant est monté sur /app/state. Sur un volume neuf il est vide :
# on y remet la graine de knowledge-base livrée dans l'image, sinon l'application
# démarre sur une base vide après chaque premier déploiement.
set -e

STATE=/app/state
mkdir -p "$STATE/data" "$STATE/knowledge-base" "$STATE/uploads"

if [ -z "$(ls -A "$STATE/knowledge-base" 2>/dev/null)" ] && [ -d /app/seed-knowledge-base ]; then
  echo "[5trade] volume neuf : copie de la graine knowledge-base"
  cp -a /app/seed-knowledge-base/. "$STATE/knowledge-base/"
fi

# Garde-fou : en production, un DATABASE_URL manquant faisait silencieusement
# basculer l'app sur des fichiers JSON éphémères — les comptes disparaissaient au
# redéploiement. On refuse de démarrer plutôt que de perdre des données.
if [ "$NODE_ENV" = "production" ] && [ -z "$DATABASE_URL" ]; then
  echo "[5trade] DATABASE_URL absent en production." >&2
  echo "  Northflank > ton service > Environment > Add variable :" >&2
  echo "  DATABASE_URL = la chaîne de connexion de l'addon PostgreSQL" >&2
  exit 1
fi

echo "[5trade] stockage : ${DATABASE_URL:+postgresql}${DATABASE_URL:-fichiers locaux (dev)}"
exec node api/server.js
