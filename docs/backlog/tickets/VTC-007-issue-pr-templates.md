# VTC-007 — Templates Issues/PR et labels

- **Epic** : EPIC-02
- **Statut** : DONE (2026-09-28) — labels dans `.github/labels.json` + `scripts/sync-labels.mjs` (JSON plutôt que YAML : aucun parseur à ajouter)
- **Risque** : LOW
- **Validation humaine** : non
- **Dépendances** : VTC-001
- **Sources** : Master Spec §24 ; `docs/process/tickets.md`

## Objectif

Que chaque Issue et PR respecte mécaniquement le format et les statuts de `docs/process/tickets.md`.

## Spécification

- `.github/ISSUE_TEMPLATE/` (issue forms YAML) : `ticket.yml` (format §24.4), `decision.yml` (contexte, options, impacts, recommandation, propriétaire, lien DEC-xx), `bug.yml` (sans données personnelles), `epic.yml` ; `config.yml` désactivant les issues vierges.
- `.github/pull_request_template.md` : ticket lié, résumé, scope/hors scope, tests exécutés, risques, impact DB/rollback, screenshots UI, checklist Definition of Done.
- `.github/labels.yml` + script `scripts/sync-labels.sh` (via `gh label create --force`) :
  - `status:backlog|needs-decision|ready|in-progress|pr-open|review|blocked|ready-to-merge|done`
  - `risk:low|medium|high|critical`, `human-approval`
  - `type:feature|infra|bug|decision|epic`, `epic:01` … `epic:16`

## Critères d'acceptation

- [ ] Les formulaires s'affichent correctement sur GitHub.
- [ ] Le script de labels est idempotent (deux exécutions = même résultat).

## Interdits / hors périmètre

Automatisations de changement de statut (EPIC-02, ultérieur).

## Rollback / impact DB

Revert. Aucun.
