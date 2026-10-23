# Réanalyse du moteur — dossier de travail

Produit avec la grille `brownfield-retrospective` (ECC). Une session peut reprendre
ici sans relire la conversation.

## Fichiers

| Fichier | Rôle |
|---|---|
| `gap-register.md` | L'état durable : périmètre, phase courante, 14 écarts avec preuve `fichier:ligne`. **Commencer par lui.** |
| `COMPARAISON-NOTIONS.md` | Chaque notion du système face à son nom standard et à sa référence, avec verdict aligné / partiel / divergent / absent. |

## Reprendre

1. Ouvrir `gap-register.md`, lire le champ `Phase courante`.
2. Prendre la première ligne dont l'état est `open` **par ordre de priorité**, pas
   par ordre de tableau.
3. Pour chaque ligne traitée : écrire le test qui échoue d'abord (le test encode
   l'invariant absent), corriger, passer le test, mettre l'état à `done` avec le
   hash du commit.

## Priorité actuelle

| Ordre | ID | Pourquoi d'abord |
|---|---|---|
| 1 | G-01 | Tant que la validation porte sur R_75, produit par un RNG cryptographique, tout chiffre positif est un artefact. Rien d'autre ne compte avant ça. |
| 2 | G-04 | La convention BE décide du signe du résultat et n'est pas arbitrée. |
| 3 | G-02, G-08 | Déflater l'avantage, puis le frotter au slippage : avant d'annoncer quoi que ce soit. |

## Règle du dossier

Aucun écart ne se ferme sans une mesure ou un test. Un `wont-fix` doit porter sa
raison, sinon il rouvre le trou qu'il prétend fermer.
