# VTC-010 — Importer le backlog dans GitHub Issues

- **Epic** : EPIC-02
- **Statut** : DONE (2026-09-28) — `node scripts/import-backlog.mjs [--apply]` ; Epics liés par liste de tâches
- **Risque** : LOW
- **Validation humaine** : non (aperçu `--dry-run` montré avant exécution)
- **Dépendances** : VTC-007
- **Sources** : Master Spec §24, §25.1, §45

## Objectif

Faire de GitHub Issues la source de vérité du backlog.

## Spécification

- Script `scripts/import-backlog.ts` (ou `.sh` avec `gh`) : lit `docs/backlog/epics.md` et `docs/backlog/tickets/*.md`, crée une Issue par Epic et par ticket avec labels (`type`, `epic`, `risk`, `status`), lie les tickets à leur Epic (sub-issues ou liste de tâches).
- Idempotent : ne recrée pas une Issue dont le titre commence par le même ID (recherche préalable).
- Mode `--dry-run` par défaut.
- Création d'un GitHub Project (optionnel) avec champ Statut aligné sur §24.1.
- Après import : `docs/backlog/README.md` indique que GitHub fait foi et liste la correspondance ID → numéro d'Issue.

## Critères d'acceptation

- [ ] 16 Epics + lot 1 importés, labels corrects.
- [ ] Seconde exécution : aucune Issue dupliquée.

## Interdits / hors périmètre

Synchronisation Notion (phase 2).

## Rollback / impact DB

Fermeture des Issues créées (liste produite par le script). Aucun impact DB.
