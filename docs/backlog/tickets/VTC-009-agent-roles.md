# VTC-009 — Subagents Planner / Developer / Reviewer

- **Epic** : EPIC-02
- **Statut** : REVIEW — agents livrés (`.claude/agents/`), restrictions d’outils par motif ; essais à blanc à faire dans une nouvelle session (les agents sont chargés au démarrage)
- **Risque** : MEDIUM
- **Validation humaine** : non
- **Dépendances** : VTC-008
- **Sources** : Master Spec §25, §26, §27.1 ; `docs/process/agents.md`

## Objectif

Matérialiser les trois rôles en subagents Claude Code avec prompts et outils distincts.

## Spécification

- `.claude/agents/planner.md` : outils lecture + `gh issue *` ; lit spec/docs/ADR/Issues ; produit Epics/tickets au format ; crée `DECISION-*` ; ne met `READY` que si la DoR est remplie ; **aucun outil d'écriture de code**.
- `.claude/agents/developer.md` : outils d'édition + commandes allowlistées ; suit le workflow `CLAUDE.md` ; s'arrête et passe `BLOCKED` sur ambiguïté métier.
- `.claude/agents/reviewer.md` : lecture seule + `gh pr view|diff|review --comment` ; checklist : régressions, sécurité, règles `BR-*`, concurrence, migrations, idempotence, tests manquants, hors scope ; verdict structuré (`APPROVE`/`REQUEST_CHANGES` + liste) ; ne valide pas sur simple absence d'erreur.
- Frontmatter conforme à la documentation Claude Code en vigueur.
- Compteur de cycles review/correction : provisoire 3 (DEC-18), au-delà → `status:blocked`.

## Critères d'acceptation

- [ ] Les trois agents apparaissent dans Claude Code et respectent leurs restrictions d'outils.
- [ ] Essai à blanc : Planner produit un ticket conforme à `docs/process/tickets.md` à partir d'une section de la spec.
- [ ] Essai à blanc : Reviewer produit un verdict structuré sur une PR existante.

## Interdits / hors périmètre

Exécution automatique en CI (INFRA-003). Incident Agent (phase 2).

## Rollback / impact DB

Revert. Aucun.
