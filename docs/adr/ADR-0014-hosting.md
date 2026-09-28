# ADR-0014 — Hébergement européen et PostgreSQL managé

- **Statut** : **Proposé** — en attente de DEC-12 (doit être accepté avant EPIC-05)
- **Date** : 2026-09-28
- **Source** : Master Spec §33.3, §54.7

## Contexte

Données personnelles de clients (RGPD), petit volume au lancement, besoin de backups/PITR fiables sans opérer PostgreSQL soi-même.

## Proposition

- Fournisseur européen avec Kubernetes managé + PostgreSQL managé avec PITR en région France : **Scaleway Kapsule** ou **OVHcloud Managed Kubernetes**.
- PostgreSQL managé (pas d'opérateur dans le cluster au lancement).
- Secrets : secret manager du fournisseur via External Secrets Operator, ou Sealed Secrets à défaut.

## À comparer avant acceptation

Prix mensuel d'un cluster minimal + DB avec PITR · support de l'extension `btree_gist` · OIDC depuis GitHub Actions · load balancer/TLS · pull depuis GHCR · offre de métriques/logs.
