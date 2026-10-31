#!/usr/bin/env bash
# 5trade — copie la base PostgreSQL LOCALE (localhost:5433) vers l'addon
# PostgreSQL de Northflank. But : retrouver en ligne exactement ce qui existe
# chez toi — comptes, stratégies, trades, sessions, OTP.
#
# Usage :
#   NF_DATABASE_URL='postgresql://...@.../5trade' bash tools/migrer-db-vers-northflank.sh
#
# Le dump est fait en une passe (schéma + données) ; l'application recrée de
# toute façon les tables manquantes au démarrage (create table if not exists),
# donc un dump sur une base cible vide est sûr.
set -euo pipefail

[ -z "${NF_DATABASE_URL:-}" ] && { echo "NF_DATABASE_URL manquant (chaîne de connexion de l'addon)."; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_URL=$(grep -m1 '^DATABASE_URL=' "$ROOT/.env" | cut -d= -f2- | tr -d '\r')
[ -z "$LOCAL_URL" ] && { echo "DATABASE_URL absente de .env"; exit 1; }

# pg_dump/psql ne sont pas toujours dans le PATH sous Windows : on cherche.
PG_BIN="${PG_BIN:-}"
if [ -z "$PG_BIN" ]; then
  for d in /c/Program\ Files/PostgreSQL/*/bin /usr/lib/postgresql/*/bin /usr/local/opt/postgresql*/bin; do
    [ -x "$d/pg_dump" ] && PG_BIN="$d" && break
  done
fi
[ -z "$PG_BIN" ] && PG_BIN="$(dirname "$(command -v pg_dump || echo /usr/bin/pg_dump)")"
echo "Outils PostgreSQL : $PG_BIN"

DUMP="$ROOT/data/dump-$(date +%Y%m%d-%H%M%S).sql"
echo "→ dump de la base locale"
"$PG_BIN/pg_dump" --no-owner --no-privileges --clean --if-exists "$LOCAL_URL" > "$DUMP"
echo "  $(wc -c < "$DUMP") octets dans $DUMP"

echo "→ restauration sur l'addon Northflank"
"$PG_BIN/psql" "$NF_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$DUMP"

echo "→ contrôle"
"$PG_BIN/psql" "$NF_DATABASE_URL" -Atc "select 'kv='||count(*) from kv" || true
"$PG_BIN/psql" "$NF_DATABASE_URL" -Atc "select 'strategies='||count(*) from strategies" || true
"$PG_BIN/psql" "$NF_DATABASE_URL" -Atc "select 'trades='||count(*) from trades" || true
echo "Terminé. Le dump reste dans $DUMP (ne pas versionner : il contient des données personnelles)."
