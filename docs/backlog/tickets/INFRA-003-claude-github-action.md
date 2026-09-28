# INFRA-003 — Claude GitHub Action (review + @claude)

- **Epic** : EPIC-02
- **Statut** : IN_PROGRESS — workflows livrés avec l’abonnement Claude du propriétaire (option gratuite, DEC-17/18 tranchées) ; reste : jeton + app GitHub à installer par le propriétaire
- **Risque** : HIGH (agent automatisé avec accès au repo, clé API)
- **Validation humaine** : **oui** — le propriétaire ajoute le secret `ANTHROPIC_API_KEY` et installe la GitHub App ; Claude ne manipule jamais la clé
- **Dépendances** : VTC-006, VTC-009
- **Sources** : Master Spec §25, §26, §27, §53

## Objectif

Automatiser la review des PR (rôle Reviewer) et permettre de déléguer une tâche via `@claude` sur une Issue/PR, sous permissions minimales.

## Spécification

- Vérifier la documentation à jour de l'action officielle Anthropic (`anthropics/claude-code-action`) : inputs, modèle, permissions.
- `.github/workflows/claude-review.yml` : sur `pull_request` (opened/synchronize), prompt Reviewer (réutilise `.claude/agents/reviewer.md`), `permissions: contents: read, pull-requests: write`, `--max-turns` et `timeout-minutes` bornés, outils allowlistés en lecture.
- `.github/workflows/claude.yml` : déclenché par mention `@claude` d'un membre autorisé (pas d'utilisateurs externes), rôle Developer, `contents: write` (branches seulement, `main` protégée), `pull-requests: write`, `issues: read`.
- Aucune exécution sur PR de fork avec secrets.
- Limite de cycles (DEC-18) et plafond de coût (DEC-17) documentés.

## Critères d'acceptation

- [ ] Une PR de test reçoit une review structurée.
- [ ] `@claude` par un non-membre n'a aucun effet.
- [ ] L'action ne peut pas pousser sur `main` (branch protection).
- [ ] Aucun secret imprimé dans les logs.

## Interdits / hors périmètre

Auto-merge. Accès cluster/cloud. Incident Agent.

## Rollback / impact DB

Désactivation des workflows. Aucun impact DB.
