# VTC-004 — Vitest et premiers tests

- **Epic** : EPIC-01
- **Statut** : DONE (2026-09-28) — Vitest 5.0.2 ; pourcentages en points de base entiers (550 = 5,5 %)
- **Risque** : LOW
- **Validation humaine** : non
- **Dépendances** : VTC-002
- **Sources** : Master Spec §43 ; ADR-0012, ADR-0009

## Objectif

Un harnais de tests unitaires opérationnel, avec un premier module utilitaire réellement utile.

## Spécification technique

- Vitest, résolution de l'alias `@/`, environnement `node` par défaut.
- Scripts `test` (run) et `test:watch` ; couverture v8 (`test:coverage`) sans seuil bloquant pour l'instant.
- Séparation prévue : `*.test.ts` (unitaire) et `*.int.test.ts` (intégration, projet Vitest séparé, activé au lot 2 avec PostgreSQL).
- Premier module : `src/lib/money.ts` — type `Money { amountCents: number; currency: 'EUR' }`, garde d'entier, addition, multiplication par quantité, pourcentage avec **arrondi explicite passé en paramètre** (pas de règle métier implicite), formatage `Intl.NumberFormat` fr-FR / en-GB.

## Critères d'acceptation

- [ ] `pnpm test` passe et est non interactif.
- [ ] `money.ts` refuse tout montant non entier (erreur explicite) et les devises différentes à l'addition.
- [ ] Tests couvrant arrondis aux bornes (x,5), montants négatifs refusés ou autorisés explicitement, formatage FR/EN.

## Interdits / hors périmètre

Tests d'intégration DB, Playwright (tickets ultérieurs).

## Rollback / impact DB

Revert. Aucun.
