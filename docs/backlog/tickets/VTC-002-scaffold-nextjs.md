# VTC-002 — Scaffold Next.js / TypeScript strict / pnpm / Node LTS

- **Epic** : EPIC-01
- **Statut** : DONE (2026-09-28) — Node 24.21 (LTS active « Krypton »), Next.js 16.3.6, React 19.2.8, pnpm 12.6.0, TypeScript 5.9 ; versions vérifiées sur nodejs.org/dist/index.json et le registre npm
- **Risque** : LOW
- **Validation humaine** : non
- **Dépendances** : VTC-001
- **Sources** : Master Spec §19, §54.2, §54.3 ; ADR-0003, ADR-0004

## Contexte

Aucun code applicatif n'existe. Les tickets CI et qualité ont besoin d'un projet qui compile.

## Objectif

Un squelette Next.js minimal, conforme à la stack figée, qui démarre et build.

## Spécification technique

- Vérifier via la documentation à jour (Context7 / sites officiels, pas de mémoire) : Node.js LTS **active** à date, dernière version stable de Next.js et de pnpm.
- `.nvmrc` + `engines.node` ; `packageManager: "pnpm@x.y.z"` (Corepack).
- Next.js App Router, `src/` directory, Tailwind CSS, `output: 'standalone'` dans `next.config.ts`.
- `tsconfig.json` : `strict: true`, `noUncheckedIndexedAccess: true`, alias `@/*` → `src/*`.
- Arborescence vide mais présente : `src/{app,domain,server,integrations,lib}` (fichier `.gitkeep` ou `index.ts` minimal).
- Page d'accueil provisoire neutre (pas de design : EPIC-06).
- Scripts : `dev`, `build`, `start`, `typecheck` (`tsc --noEmit`).

## Critères d'acceptation

- [ ] `pnpm install --frozen-lockfile && pnpm build` réussit sur un clone propre.
- [ ] `pnpm typecheck` réussit.
- [ ] `.next/standalone` produit au build.
- [ ] Versions choisies et source de vérification notées dans la PR.

## Tests attendus

Build + typecheck (les tests unitaires arrivent en VTC-004).

## Interdits / hors périmètre

Prisma, auth, i18n, design system, dépendances non listées dans ADR-0003.

## Rollback / impact DB

Revert de la PR. Aucun impact DB.
