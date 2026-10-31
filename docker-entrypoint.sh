#!/bin/sh
# 5trade — démarrage en conteneur, identique sur Render, Koyeb, Hostless,
# Northflank, Fly, Railway ou un VPS Docker.
#
# Les trois dossiers de données sont pilotés par DATA_DIR, KNOWLEDGE_BASE_DIR et
# UPLOADS_DIR (valeurs par défaut : /app/state/...). La plateforme n'a qu'à
# monter son volume sur /app/state, ou pointer ces variables où elle veut.
#
# Sur un volume neuf, on recopie les graines livrées dans l'image (stratégies
# importées, lexique, comptes, alertes). Sans ça, un premier déploiement donne
# une application vide : « mes stratégies ont disparu ».
set -e

: "${DATA_DIR:=/app/state/data}"
: "${KNOWLEDGE_BASE_DIR:=/app/state/knowledge-base}"
: "${UPLOADS_DIR:=/app/state/uploads}"
export DATA_DIR KNOWLEDGE_BASE_DIR UPLOADS_DIR

mkdir -p "$DATA_DIR" "$KNOWLEDGE_BASE_DIR" "$UPLOADS_DIR"

remplir() {  # remplir <graine> <cible> <libelle>
  if [ -d "$1" ] && [ -z "$(ls -A "$2" 2>/dev/null)" ]; then
    echo "[5trade] volume neuf : copie de $3"
    cp -a "$1/." "$2"/
  fi
}
remplir /app/seed-knowledge-base "$KNOWLEDGE_BASE_DIR" "knowledge-base (stratégies, concepts, documents)"
remplir /app/seed-data "$DATA_DIR" "data (lexique, comptes, alertes, historique de signaux)"

# Garde-fou : en production, un DATABASE_URL manquant faisait silencieusement
# basculer l'app sur des fichiers JSON éphémères — les comptes disparaissaient au
# redéploiement. On refuse de démarrer plutôt que de perdre des données.
if [ "$NODE_ENV" = "production" ] && [ -z "$DATABASE_URL" ]; then
  echo "[5trade] DATABASE_URL absent en production." >&2
  echo "  Ajoute la chaîne de connexion PostgreSQL de la plateforme" >&2
  echo "  (Render : depuis la ressource PostgreSQL du Blueprint ; Hostless : onglet Database)." >&2
  exit 1
fi

if [ -n "$DATABASE_URL" ]; then
  # Jamais la chaîne complète : elle contient le mot de passe, et ce log est
  # public dans la console de la plateforme.
  echo "[5trade] stockage : PostgreSQL $(printf '%s' "$DATABASE_URL" | sed -E 's#://[^@]*@#://***@#')"
else
  echo "[5trade] stockage : fichiers JSON locaux (développement)"
fi

echo "[5trade] données : $DATA_DIR | $KNOWLEDGE_BASE_DIR | $UPLOADS_DIR"
exec node api/server.js
