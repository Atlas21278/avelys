# ADR-0003 — Stack runtime et outillage

- **Statut** : Accepté
- **Date** : 2026-09-28
- **Source** : Master Spec §19, §54.2

## Décision

| Élément     | Choix                                                             |
| ----------- | ----------------------------------------------------------------- |
| Runtime     | Node.js LTS active au bootstrap, fixée dans `.nvmrc` et `engines` |
| Paquets     | pnpm, fixé via `packageManager` + Corepack                        |
| Framework   | Next.js dernière stable, App Router, `output: 'standalone'`       |
| Langage     | TypeScript `strict` + `noUncheckedIndexedAccess`                  |
| Styles      | Tailwind CSS + design system maison                               |
| Validation  | Zod (API, formulaires, env, webhooks)                             |
| i18n        | next-intl, `fr` (défaut) et `en`                                  |
| Dates       | UTC en stockage ; `date-fns` + `@date-fns/tz` (Europe/Paris)      |
| Logs        | pino JSON                                                         |
| Erreurs     | Sentry                                                            |
| Lint/format | ESLint (config Next.js) + Prettier                                |
| Scans       | gitleaks, `pnpm audit` / Dependabot, Trivy (image + SBOM)         |

Les versions exactes sont vérifiées au moment de VTC-002 (documentation à jour, pas de mémoire) et fixées dans le lockfile.

## Conséquences

Un seul langage de bout en bout. Changer un de ces éléments exige un nouvel ADR.
