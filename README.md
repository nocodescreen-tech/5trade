# Plateforme de Trading IA - Documentation

## Structure du projet

```
trading-platform/
├── api/                    # Backend Node.js
│   ├── server.js          # Serveur principal
│   ├── package.json       # Dépendances
│   └── uploads/           # Fichiers uploadés
├── frontend/               # Frontend React
│   ├── index.html         # Interface principale
│   └── package.json       # Dépendances
├── knowledge-base/        # Base de connaissance
│   ├── documents/         # Documents originaux
│   └── *.json            # Stratégies extraites
├── data/                  # Données utilisateur
│   └── users/            # Configuration utilisateur
└── README.md             # Documentation
```

## Fonctionnalités principales

### 1. Upload de documents stratégiques
- Formats supportés: `.txt`, `.pdf`, `.docx`, `.md`
- Extraction automatique du texte
- Création automatique de stratégies dans la base de connaissance
- Organisation par tags et types

### 2. Analyse d'images TradingView
- Upload de captures d'écran TradingView
- Analyse IA avec DeepSeek API
- Reconnaissance de patterns et tendances
- Génération de recommandations de trading

### 3. Base de connaissance évolutive
- Recherche intelligente dans les stratégies
- Combinaison de stratégies pour recommandations
- Tags automatiques et scoring de pertinence
- Historique des analyses

### 4. Interface utilisateur
- Design canonique et épuré
- Interface de login unique (compte: rene)
- Onglets pour différentes fonctionnalités
- Responsive design

## Comment utiliser

### 1. Démarrer l'API
```bash
cd api
npm install
node server.js
```

### 2. Ouvrir l'interface
Ouvrir `frontend/index.html` dans le navigateur

### 3. Connexion
- Username: `rene`
- Password: `trading2024`

### 4. Upload de stratégies
- Allez dans l'onglet "Documents"
- Cliquez sur "Uploader Documents"
- Sélectionnez vos fichiers (.txt, .pdf, .docx, .md)
- L'application extrait automatiquement le contenu

### 5. Analyse de graphiques
- Allez dans l'onglet "Analyse"
- Upload votre capture TradingView
- Sélectionnez la paire et le timeframe
- Obtenez des recommandations basées sur vos stratégies

## Configuration

### Variables d'environnement (.env)
```env
DEEPSEEK_API_KEY=your_deepseek_api_key_here
PORT=3001
NODE_ENV=development
```

### Compte utilisateur unique
- Username: `rene`
- Password: `trading2024`
- Configuration sauvegardée dans `data/users/rene/config.json`

## Technologies utilisées

### Backend
- Node.js + Express
- Multer pour les uploads
- PDF-parse pour l'extraction PDF
- DeepSeek API pour l'analyse IA

### Frontend
- React (via CDN)
- Tailwind CSS
- Font Awesome icons
- Design épuré et fonctionnel

## Déploiement

### Développement
```bash
# Démarrer l'API
cd api && node server.js

# Ouvrir le frontend
open frontend/index.html
```

### Production
- Configurer les variables d'environnement
- Utiliser un serveur web pour le frontend
- Configurer un reverse proxy pour l'API

## Extension de fonctionnalités

### Ajouter de nouveaux types de fichiers
1. Modifier la fonction `extractTextFromFile` dans `server.js`
2. Ajouter le nouveau format dans le switch case

### Intégrer d'autres IA
1. Créer une nouvelle fonction d'analyse (ex: `analyzeWithOpenAI`)
2. Modifier la fonction `analyzeWithDeepSeek` pour choisir le provider

### Ajouter de nouvelles sources de stratégies
1. Créer une nouvelle fonction d'import (ex: `importFromWeb`)
2. Ajouter le bouton correspondant dans l'interface

## Sécurité

- Validation des fichiers uploadés
- Limites de taille (50MB max)
- Nettoyage automatique des fichiers temporaires
- Authentification unique pour l'utilisateur

## Performance

- Indexation des stratégies pour recherche rapide
- Caching des résultats d'analyse
- Compression des fichiers uploadés
- Optimisation des requêtes API

---

Cette plateforme est conçue pour évoluer avec vos besoins de trading et stratégies personnelles.