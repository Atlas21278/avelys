# Agents Claude et garde-fous

Source : Master Spec §25, §26, §27.

## Rôles

| Rôle           | Fait                                                                                                                                                                                                                            | Ne fait pas                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Planner        | Lit spec + docs + ADR + état GitHub ; crée/actualise Epics et Issues ; détecte dépendances ; met `READY` seulement ce qui l'est ; crée `DECISION-*`                                                                             | Coder                                                             |
| Developer      | Prend le prochain `READY` autorisé ; branche ; implémente le scope ; tests ; checks ; PR (résumé, tests, risques, screenshots UI)                                                                                               | Merger sa propre PR si approbation requise ; sortir du scope      |
| Reviewer       | Rôle/prompt distinct ; analyse diff + ticket + docs ; cherche régressions, sécurité, erreurs métier, concurrence, migrations, idempotence, tests manquants ; commentaires actionnables ; peut relancer une boucle de correction | Approuver sur simple absence d'erreur de syntaxe ; écrire du code |
| Incident Agent | **Phase 2**                                                                                                                                                                                                                     | —                                                                 |

Les rôles sont matérialisés par des subagents `.claude/agents/*.md` (VTC-009) et par le workflow Claude GitHub Action (INFRA-003).

## Garde-fous

- Jamais de push direct sur `main` ; jamais de contournement de branch protection.
- Jamais de secret dans prompt, ticket, log ou commit.
- Jamais de `kubectl` admin prod pour Developer ; jamais de token admin Argo.
- Jamais de `DROP`/`TRUNCATE` ou migration destructive prod automatique.
- Jamais de modification des règles de prix sans ticket explicite.
- Jamais de désactivation de tests pour verdir la CI.
- Cycles review/correction max configurable (DEC-18, provisoire 3) ; au-delà → `BLOCKED` + humain.
- Budget IA par ticket configurable (DEC-18).
- Mode non interactif : `--max-turns`, timeouts, sortie structurée.

## Permissions GitHub minimales

| Rôle           | Permissions                                                                      |
| -------------- | -------------------------------------------------------------------------------- |
| Planner        | contents: read ; issues: write ; pas de secrets ; pas de merge                   |
| Developer      | contents: write (branches) ; pull-requests: write ; issues: read ; actions: read |
| Reviewer       | contents: read ; pull-requests: write (commentaires) ; checks: read              |
| CI build       | contents: read ; packages: write ; attestations/id-token selon job               |
| GitOps updater | écriture limitée au repo `avelys-gitops`                                         |

## Connecteurs

| Système                                                                                     | Niveau      | Remarque                                                                                                |
| ------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| GitHub, Claude Code, GitHub Actions, GHCR, Argo CD                                          | Obligatoire | Argo : pas de token admin pour Developer                                                                |
| Kubernetes, cloud, secret manager, Sentry, Stripe (test), Maps, Resend, PostgreSQL, DNS/TLS | Limité      | Lecture/diagnostic ; changements via GitOps ; credentials injectés par l'environnement, jamais en texte |
| Notion                                                                                      | Phase 2     | Base projet dédiée uniquement                                                                           |

MCP projet (`.mcp.json`) : uniquement les serveurs réellement nécessaires, allowlist par rôle, filesystem limité au workspace.
