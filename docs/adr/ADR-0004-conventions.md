# ADR-0004 — Conventions de code, commits et routes

- **Statut** : Accepté
- **Date** : 2026-09-28
- **Source** : Master Spec §19.1, §29, §54.3

## Décision

- **Commits** : Conventional Commits avec ID ticket (`feat(pricing): VTC-024 server-side quote`).
- **Branches** : `feature/VTC-xxx-slug`, `fix/BUG-xxx-slug`, `infra/INFRA-xxx-slug` ; squash merge.
- **Structure** : `src/app` (routes/UI), `src/domain` (règles pures), `src/server` (services, données), `src/integrations` (Stripe, Maps, Resend), `src/lib` (utilitaires).
- **Routes** : FR sans préfixe, EN sous `/en`.
- **Argent** : centimes `Int` + ISO 4217 (ADR-0009).
- **Langue** : code en anglais ; docs FR ; contenus FR/EN.

## Conséquences

La logique métier est testable sans framework. Un lint de frontières d'import (`src/domain` n'importe ni `server`, ni `integrations`, ni Prisma) est mis en place par VTC-003.
