# VTC-003 — ESLint, Prettier et frontières d'import

- **Epic** : EPIC-01
- **Statut** : DONE (2026-09-28) — ESLint épinglé en 9.x : `eslint-plugin-react`, `jsx-a11y` et `import` (via eslint-config-next 16.3.6) ne supportent pas encore ESLint 10
- **Risque** : LOW
- **Validation humaine** : non
- **Dépendances** : VTC-002
- **Sources** : Master Spec §19.1, §54.2 ; ADR-0004

## Objectif

Lint et formatage homogènes, et empêcher mécaniquement que la logique métier dépende de l'infrastructure.

## Spécification technique

- ESLint (config Next.js, flat config) + règles TypeScript type-aware raisonnables.
- Prettier (+ `prettier-plugin-tailwindcss`), `eslint-config-prettier`.
- Règle de frontières (`no-restricted-imports` ou `eslint-plugin-boundaries`) :
  - `src/domain/**` ne peut importer ni `@/server`, ni `@/integrations`, ni `@/app`, ni `@prisma/client`, ni `next/*`.
  - `src/app/**` n'importe pas `@/integrations` directement.
- Scripts `lint`, `format`, `format:check`.
- `.editorconfig`.

## Critères d'acceptation

- [ ] `pnpm lint` et `pnpm format:check` passent sur le repo.
- [ ] Un import interdit dans `src/domain` fait échouer `pnpm lint` (démontré dans la PR, puis retiré).

## Interdits / hors périmètre

Hooks git (optionnels, ticket séparé si souhaité). Désactiver des règles pour faire passer du code.

## Rollback / impact DB

Revert. Aucun.
