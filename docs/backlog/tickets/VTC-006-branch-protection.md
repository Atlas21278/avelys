# VTC-006 — Branch protection et CODEOWNERS

- **Epic** : EPIC-03
- **Statut** : DONE (2026-09-28) — ruleset actif sur le dépôt public `Atlas21278/avelys` (DEC-23 tranchée : option gratuite)
- **Risque** : HIGH (gouvernance du repo)
- **Validation humaine** : **oui** — réglages appliqués par le propriétaire (droits admin repo)
- **Dépendances** : INFRA-001 (et INFRA-002 pour les checks requis)
- **Sources** : Master Spec §26, §29

## Objectif

Rendre impossible l'intégration sur `main` sans PR et sans checks verts, et exiger la revue humaine des fichiers sensibles.

## Spécification

- `.github/CODEOWNERS` : propriétaire(s) sur `prisma/migrations/`, `.github/workflows/`, `.github/CODEOWNERS`, `charts/`, `src/integrations/stripe/`, `src/domain/pricing/`, `.claude/`, `CLAUDE.md`.
- Ruleset (ou branch protection) sur `main` : PR obligatoire, checks requis `ci`, `secrets`, `deps`, pas de force push, pas de suppression, historique linéaire (squash), revue CODEOWNERS requise, conversations résolues.
- Paramètres repo : squash merge uniquement, suppression auto des branches mergées.
- Documenter la configuration appliquée dans `docs/infra/gitops.md` (le ruleset peut être exporté en JSON dans `.github/rulesets/` pour traçabilité).

## Critères d'acceptation

- [ ] Push direct sur `main` refusé (vérifié).
- [ ] PR avec check rouge non mergeable.
- [ ] Modifier un fichier sous `.github/workflows/` exige l'approbation CODEOWNER.

## Interdits / hors périmètre

Donner à un agent les droits admin du repo pour appliquer ce ticket.

## Rollback / impact DB

Désactivation du ruleset par le propriétaire. Aucun impact DB.
