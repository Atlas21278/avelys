# INFRA-001 — Workflow CI de base

- **Epic** : EPIC-03
- **Statut** : DONE (2026-09-28) — checkout v7.0.1, pnpm/action-setup v6.1.0, setup-node v7.0.0, upload-artifact v7.0.1, épinglées par SHA
- **Risque** : MEDIUM
- **Validation humaine** : non (fichier CODEOWNERS une fois VTC-006 fait)
- **Dépendances** : VTC-003, VTC-004
- **Sources** : Master Spec §30 ; `docs/infra/gitops.md`

## Objectif

Chaque PR et chaque push sur `main` exécutent les contrôles obligatoires de base.

## Spécification technique

- `.github/workflows/ci.yml`, déclencheurs `pull_request` et `push` sur `main`, `concurrency` par ref (annulation des runs obsolètes).
- `permissions: contents: read` au niveau workflow ; rien de plus.
- Setup : `actions/checkout`, `pnpm/action-setup`, `actions/setup-node` avec `node-version-file: .nvmrc` et cache pnpm.
- Étapes : `pnpm install --frozen-lockfile` → `lint` → `format:check` → `typecheck` → `test` → `build`.
- Actions tierces épinglées par SHA de commit.
- Upload des rapports de tests (rétention 14 jours).
- Nom de job stable (`ci`) pour être référencé comme check requis par VTC-006.

## Critères d'acceptation

- [ ] Workflow vert sur la PR qui l'introduit.
- [ ] Une erreur de lint ou un test en échec rend le check rouge (démontré).
- [ ] Aucune variable secrète utilisée.

## Interdits / hors périmètre

Build Docker (EPIC-04), E2E, tests d'intégration DB (lot 2), scans (INFRA-002).

## Rollback / impact DB

Revert. Aucun.
