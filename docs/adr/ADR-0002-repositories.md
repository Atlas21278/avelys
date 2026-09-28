# ADR-0002 — Repo applicatif unique et repo GitOps séparé

- **Statut** : Accepté
- **Date** : 2026-09-28
- **Source** : Master Spec §35, §54.1

## Contexte

Une seule application Next.js, un chart Helm, des workflows. Le déploiement suit un modèle GitOps.

## Décision

- `avelys` (marque validée, DEC-01) : app Next.js + Prisma + chart Helm (`charts/avelys`) + workflows. Pas de monorepo.
- `avelys-gitops` : values par environnement et Applications Argo CD. Seul le workflow GitOps updater y écrit les digests.

## Conséquences

- Les droits d'écriture sur l'état déployé sont séparés des droits sur le code.
- Le dossier local de travail peut garder un autre nom ; le repo GitHub s’appelle `avelys`.

## Alternatives écartées

Monorepo (inutile pour une seule app) ; values d'environnement dans le repo applicatif (mélange droits code/déploiement).
