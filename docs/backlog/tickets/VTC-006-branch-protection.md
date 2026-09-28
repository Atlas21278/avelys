# VTC-006 — Branch protection et CODEOWNERS

- **Epic** : EPIC-03
- **Statut** : DONE (2026-09-28) — ruleset actif sur le dépôt public `Atlas21278/avelys` (DEC-23 tranchée : option gratuite) ; revue CODEOWNERS reportée (voir critères d'acceptation)
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

- [x] Push direct sur `main` refusé (ruleset actif + hook `.githooks/pre-push`).
- [x] PR avec check rouge non mergeable (checks `ci`, `secrets`, `deps` requis par le ruleset).
- [ ] Modifier un fichier sous `.github/workflows/` exige l'approbation CODEOWNER — **écart accepté** : un seul compte GitHub existe et l'auteur d'une PR ne peut pas l'approuver, donc `require_code_owner_review: false` et 0 approbation (`docs/infra/gitops.md`). À activer quand le second associé aura un compte (INFRA-004, Atlas21278/avelys-private#59).

## Interdits / hors périmètre

Donner à un agent les droits admin du repo pour appliquer ce ticket.

## Rollback / impact DB

Désactivation du ruleset par le propriétaire. Aucun impact DB.
