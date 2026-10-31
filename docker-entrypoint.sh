#!/bin/sh
# 5trade — démarrage en conteneur.
#
# Le volume persistant est monté sur /app/state. Sur un volume neuf il est vide :
# on y remet les graines livrées dans l'image (stratégies importées, lexique,
# comptes, alertes…). Sans ça, un premier déploiement démarre sur une application
# vide : « mes stratégies ont disparu ».
#   /app/seed-knowledge-base -> /app/state/knowledge-base
#   /app/seed-data           -> /app/state/data
set -e

STATE=/app/state
mkdir -p "$STATE/data" "$STATE/knowledge-base" "$STATE/uploads"

remplir() {  # remplir <graine> <cible> <libelle>
  if [ -d "$1" ] && [ -z "$(ls -A "$2" 2>/dev/null)" ]; then
    echo "[5trade] volume neuf : copie de $3"
    cp -a "$1/." "$2"/
  fi
}
remplir /app/seed-knowledge-base "$STATE/knowledge-base" "knowledge-base (stratégies, concepts, documents)"
remplir /app/seed-data "$STATE/data" "data (lexique, comptes, alertes, historique de signaux)"

# Garde-fou : en production, un DATABASE_URL manquant faisait silencieusement
# basculer l'app sur des fichiers JSON éphémères — les comptes disparaissaient au
# redéploiement. On refuse de démarrer plutôt que de perdre des données.
if [ "$NODE_ENV" = "production" ] && [ -z "$DATABASE_URL" ]; then
  echo "[5trade] DATABASE_URL absent en production." >&2
  echo "  Northflank > ton service > Environment > Add variable :" >&2
  echo "  DATABASE_URL = la chaîne de connexion de l'addon PostgreSQL" >&2
  exit 1
fi

if [ -n "$DATABASE_URL" ]; then
  # Jamais la chaîne complète : elle contient le mot de passe, et ce log est public
  # dans la console de la plateforme.
  echo "[5trade] stockage : PostgreSQL $(printf '%s' "$DATABASE_URL" | sed -E 's#://[^@]*@#://***@#')"
else
  echo "[5trade] stockage : fichiers JSON locaux (développement)"
fi

echo "[5trade] état : $(du -sh "$STATE" 2>/dev/null | cut -f1) dans /app/state"
exec node api/server.js
