---
name: forex-session-monitor
description: Surveillance cognitive des horaires de marchés, sessions Forex/Métaux, alertes de pré-clôture du vendredi et réouverture du dimanche.
version: 1.0.0
author: 5TRADE Cognitive Engine
---

# Forex Session Monitor

## Rôle
Cette compétence surveille en continu le calendrier hebdomadaire et quotidien des marchés financiers pour :
1. Empêcher l'émission de signaux ou d'analyses techniques sur des marchés fermés (Forex et Métaux le samedi et dimanche).
2. Avertir l'utilisateur sur Telegram et le tableau de bord le vendredi soir à 21h30 UTC avant la clôture hebdomadaire.
3. Notifier l'utilisateur le dimanche soir à 22h00 UTC lors de la réouverture des cotations avec analyse des éventuels gaps de week-end.
4. Orienter automatiquement le trader vers les marchés 24/7 (indices synthétiques Deriv et crypto-monnaies) pendant les fermetures du Forex.

## Actions disponibles
- `verifier_session` : Retourne l'état précis d'ouverture, fermeture ou pré-fermeture pour un instrument ou une liste d'instruments.
- `bilan_marches` : Fournit un panorama complet des classes d'actifs ouvertes et fermées à l'instant T.
- `alerte_telegram` : Génère le texte formaté prêt à l'envoi pour Telegram.

## Invariants
- Ne peut jamais contourner les limites de risque ni forcer des ordres hors session.
