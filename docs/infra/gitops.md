# CI/CD et GitOps

Source : Master Spec §29, §30, §32, §35, §36. ADR-0002, ADR-0013.

## Pipeline

```
PR ─► CI (lint, typecheck, tests, build, gitleaks, audit, helm lint)
merge main ─► build image ─► Trivy + SBOM ─► push GHCR (tag SHA, digest)
          ─► workflow GitOps : PR/commit dans avelys-gitops (staging values ← digest)
          ─► Argo CD auto-sync staging ─► smoke/E2E staging
promotion ─► PR GitOps prod (même digest) ─► approbation ─► Argo CD sync prod
```

## CI — contrôles obligatoires

`pnpm install --frozen-lockfile` · lint · typecheck · tests unitaires · intégration (PostgreSQL service) · `next build` · gitleaks · `pnpm audit` / Dependabot · pour l'image : build Docker + Trivy + SBOM · E2E selon branche · artefacts de test conservés (rétention raisonnable) · aucune sortie de secret. Permissions `GITHUB_TOKEN` déclarées par job, minimales.

### Workflows en place

| Workflow            | Job (check requis) | Contenu                                                                                                                                                       |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`            | `ci`               | install figé, lint, format, typecheck, Vitest (rapport JUnit 14 j), build                                                                                     |
| `security.yml`      | `secrets`          | gitleaks 8.30.1 (binaire vérifié par SHA-256), commits de la PR ou tout l'historique sur `main`, sortie `--redact`                                            |
| `security.yml`      | `deps`             | `pnpm audit` ; aussi chaque lundi (cron)                                                                                                                      |
| `claude-review.yml` | — (non bloquant)   | review de chaque PR prête par Claude (consignes `.claude/agents/reviewer.md`), commentaire en français, 30 tours max ; ignorée sans `CLAUDE_CODE_OAUTH_TOKEN` |
| `claude.yml`        | —                  | tâche déléguée par `@claude` (membres du repo uniquement), 60 tours max, jamais de merge                                                                      |

### Politique de sévérité des dépendances

- Dépendances de production : une vulnérabilité `high` ou `critical` **bloque** la PR.
- Dépendances de développement : signalées, non bloquantes (elles ne sont pas dans l'image).
- `moderate`/`low` : traitées via les PR Dependabot hebdomadaires (npm et GitHub Actions, groupées minor/patch).
- Un faux positif gitleaks s'ajoute à `.gitleaks.toml` avec une justification ; jamais de désactivation du job.

## Stratégie Git

- `main` toujours déployable, protégée : checks requis, pas de force push, approbation selon risque.
- **État au 2026-09-28** : ruleset prêt (`.github/rulesets/main.json`, appliqué par `scripts/apply-ruleset.sh`) mais **non actif** — un repo privé sur un compte GitHub gratuit n’a pas accès aux rulesets (DEC-23). En attendant : squash merge seul et suppression des branches mergées activés, hook local `.githooks/pre-push` refusant tout push sur `main` (`git config core.hooksPath .githooks` une fois par clone), et vérification manuelle que `ci`, `secrets` et `deps` sont verts avant tout merge.
- Ruleset : PR obligatoire, checks `ci`/`secrets`/`deps` à jour, historique linéaire, pas de force push ni de suppression, fils de discussion résolus, squash uniquement. **0 approbation requise** : un seul compte GitHub existe et l’auteur d’une PR ne peut pas l’approuver ; passer à 1 approbation + revue CODEOWNERS quand le second associé aura un compte.
- Branches courtes `feature/VTC-*`, `fix/BUG-*`, `infra/INFRA-*` ; squash merge.
- CODEOWNERS sur `prisma/migrations/`, `.github/workflows/`, `charts/`, `src/integrations/stripe/`, `src/domain/pricing/`.

## Repo GitOps `avelys-gitops`

```
apps/
  staging/  application.yaml, values.yaml
  prod/     application.yaml, values.yaml
```

- Seul le workflow « GitOps updater » (token limité à ce repo/chemin) écrit les digests.
- Staging : auto-sync + self-heal. Production : politique DEC-16.
- Pas de Force/Replace destructif sans justification ; sync waves seulement si l'ordre l'exige (migration avant rollout).

## Promotion staging → production

Même digest (jamais de rebuild) · smoke/E2E critiques verts · health K8s vert · migration compatible · aucune nouvelle alerte critique · approbation humaine pour `HIGH`/`CRITICAL` · PR GitOps ou environnement GitHub protégé · rollback documenté (`runbooks.md`).

## Registry

GHCR privé ; seule la CI pousse ; rétention conservant les images nécessaires aux rollbacks ; jamais une image différente sous un tag existant ; signature/attestation recommandée (`actions/attest-build-provenance`).
