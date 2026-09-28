# ADR-0001 — Consigner les décisions d'architecture dans des ADR

- **Statut** : Accepté
- **Date** : 2026-09-28
- **Source** : Master Spec §0.1, §51

## Contexte

La Master Spec est la source de niveau 1. Les décisions prises après le démarrage (niveau 2) doivent être traçables et révisables sans réécrire la spec.

## Décision

- Chaque décision d'architecture est un fichier `docs/adr/ADR-NNNN-slug.md` (modèle : `ADR-0000-template.md`).
- Un ADR accepté n'est jamais réécrit : il est remplacé par un nouvel ADR (`Remplacé par`).
- Les décisions de bootstrap de la section 54 font l'objet des ADR 0002 à 0015.
- Les décisions métier non tranchées vivent dans `private/docs/decisions/register.md`, pas dans un ADR.

## Conséquences

Toute PR qui change une décision structurante inclut un ADR. Les agents lisent les ADR avant de planifier.
