# ADR-0013 — Livraison : Docker, GHCR, Helm, Argo CD

- **Statut** : Accepté
- **Date** : 2026-09-28
- **Source** : Master Spec §30–§36

## Décision

- Image multi-stage non-root depuis la sortie `standalone`, taguée SHA, référencée par digest, scannée (Trivy) avec SBOM.
- GHCR privé ; seule la CI pousse.
- Chart Helm `charts/avelys` dans le repo app ; values d'environnement dans `avelys-gitops`.
- Argo CD : staging auto-sync ; production par PR GitOps approuvée (DEC-16).
- Promotion du même digest ; jamais de rebuild ; jamais de `kubectl` manuel.
- OIDC GitHub → cloud si supporté.

## Conséquences

Rollback = revert du digest dans GitOps. L'infra (EPIC-04/05) démarre après la CI de base et après DEC-12.
