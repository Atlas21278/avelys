# INFRA-002 — Scans secrets et dépendances

- **Epic** : EPIC-03
- **Statut** : DONE (2026-09-28) — gitleaks CLI 8.30.1 vérifié par SHA-256 (pas l’action, qui exige une licence en organisation)
- **Risque** : MEDIUM
- **Validation humaine** : non
- **Dépendances** : INFRA-001
- **Sources** : Master Spec §30, §32, §54.2

## Objectif

Détecter automatiquement les secrets commités et les dépendances vulnérables.

## Spécification technique

- Job `secrets` : gitleaks sur l'historique de la PR (config `.gitleaks.toml` minimale, allowlist documentée si faux positifs).
- Job `deps` : `pnpm audit --audit-level=high` (bloquant sur `high`/`critical` en prod deps ; politique à noter dans `docs/infra/gitops.md`).
- `.github/dependabot.yml` : npm hebdomadaire (groupes minor/patch), github-actions hebdomadaire.
- Permissions minimales par job.

## Critères d'acceptation

- [ ] Un faux secret de test (format AWS d'exemple) dans une branche de démonstration fait échouer `secrets`, puis est retiré (ne pas merger).
- [ ] Dependabot configuré et valide.
- [ ] Politique de sévérité documentée.

## Interdits / hors périmètre

Trivy/SBOM (EPIC-04). Désactiver le scan pour faire passer une PR.

## Rollback / impact DB

Revert. Aucun.
