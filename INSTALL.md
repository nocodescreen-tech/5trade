# Installation rapide

## Prérequis
- Node.js (v14+)
- npm ou yarn

## 1. Cloner le projet
```bash
git clone https://github.com/votre-repo/trading-platform.git
cd trading-platform
```

## 2. Installer les dépendances
```bash
# Backend
cd api
npm install

# Frontend
cd ../frontend
npm install
```

## 3. Configurer l'environnement
```bash
# Créer le fichier .env dans le dossier api
cd ../api
cp .env.example .env
# Éditer .env avec votre clé NVIDIA_API_KEY (gratuite, build.nvidia.com)
```

## 4. Démarrer l'application
```bash
# Démarrer l'API (dans le dossier api)
npm start

# Dans un autre terminal, ouvrir le frontend
cd ../frontend
npm start
```

## 5. Accéder à l'application
- Frontend: http://localhost:3000
- API: http://localhost:3001

## Connexion
- Authentification par OTP email (configurer SMTP_HOST/SMTP_USER/SMTP_PASS
  dans .env, ou BREVO_API_KEY)
- POST /api/signup avec votre email → code OTP envoyé
- POST /api/verify-otp avec le code reçu