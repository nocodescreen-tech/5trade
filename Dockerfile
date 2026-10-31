# ─────────────────────────────────────────────────────────────
# 5trade — image de production (Northflank, Render, Koyeb, Fly…)
# ─────────────────────────────────────────────────────────────
# Un seul processus : Express sert l'API ET le frontend (même origine).
# Les données qui doivent survivre à un redéploiement vivent dans /app/state,
# destiné à un volume persistant : data/ (journal, coûts, cache marché),
# knowledge-base/ (stratégies importées) et api/uploads/ (captures envoyées).
# ─────────────────────────────────────────────────────────────
FROM node:22-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DATA_DIR=/app/state/data \
    KNOWLEDGE_BASE_DIR=/app/state/knowledge-base \
    UPLOADS_DIR=/app/state/uploads

WORKDIR /app

# Dépendances d'abord : cette couche reste en cache tant que le lockfile ne bouge pas.
COPY api/package.json api/package-lock.json ./api/
RUN cd api && (npm ci --omit=dev || npm install --omit=dev) && npm cache clean --force

COPY . .

# Graines copiées dans le volume au premier démarrage : stratégies importées,
# concepts, lexique, comptes, alertes, historique de signaux. Un volume neuf ne
# doit pas donner une application vide.
RUN cp -a /app/knowledge-base /app/seed-knowledge-base \
 && cp -a /app/data /app/seed-data \
 && rm -rf /app/knowledge-base /app/data /app/api/uploads \
 && mkdir -p /app/state/data /app/state/knowledge-base /app/state/uploads \
 && chmod +x /app/docker-entrypoint.sh

EXPOSE 3001

# Sonde lue par la plateforme (Northflank : Health checks > HTTP /healthz).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./docker-entrypoint.sh"]
