#!/bin/bash

# Script de déploiement de la plateforme de trading
# Usage: ./deploy.sh [dev|prod]

ENVIRONMENT=${1:-dev}
PORT=${2:-3001}

echo "🚀 Déploiement de la plateforme de trading IA - Environnement: $ENVIRONMENT"

# Vérifier si Node.js est installé
if ! command -v node &> /dev/null; then
    echo "❌ Node.js n'est pas installé. Veuillez installer Node.js."
    exit 1
fi

# Vérifier si npm est installé
if ! command -v npm &> /dev/null; then
    echo "❌ npm n'est pas installé. Veuillez installer npm."
    exit 1
fi

echo "✅ Node.js et npm sont installés"

# Installer les dépendances de l'API
echo "📦 Installation des dépendances API..."
cd api
npm install

# Démarrer le serveur API
echo "🚀 Démarrage du serveur API..."
node server.js &
API_PID=$!

# Retourner au répertoire principal
cd ..

# Ouvrir le frontend dans le navigateur
echo "🌐 Ouverture du frontend..."
if command -v start &> /dev/null; then
    start index.html
elif command -v open &> /dev/null; then
    open index.html
fi

echo "✅ Plateforme déployée avec succès!"
echo "📊 API: http://localhost:$PORT"
echo "🖥️  Frontend: index.html"
echo "🔧 PID API: $API_PID"

# Instructions pour arrêter
echo ""
echo "Pour arrêter le serveur: kill $API_PID"