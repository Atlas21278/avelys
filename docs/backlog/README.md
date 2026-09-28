# Backlog

**Depuis le 2026-09-28, GitHub Issues fait foi, dans le dépôt privé `Atlas21278/avelys-private`** (les numéros ci-dessous y renvoient) (import par VTC-010, `node scripts/import-backlog.mjs --apply`). Ce dossier est l’archive d’import : les nouveaux tickets se créent directement dans GitHub (formulaires `.github/ISSUE_TEMPLATE/`).

| ID        | Issue | ID           | Issue | ID      | Issue |
| --------- | ----- | ------------ | ----- | ------- | ----- |
| EPIC-01   | #14   | EPIC-09      | #22   | VTC-001 | #33   |
| EPIC-02   | #15   | EPIC-10      | #23   | VTC-002 | #34   |
| EPIC-03   | #16   | EPIC-11      | #24   | VTC-003 | #35   |
| EPIC-04   | #17   | EPIC-12      | #25   | VTC-004 | #36   |
| EPIC-05   | #18   | EPIC-13      | #26   | VTC-005 | #37   |
| EPIC-06   | #19   | EPIC-14      | #27   | VTC-006 | #38   |
| EPIC-07   | #20   | EPIC-15      | #28   | VTC-007 | #39   |
| EPIC-08   | #21   | EPIC-16      | #29   | VTC-008 | #40   |
| INFRA-001 | #30   | INFRA-002    | #31   | VTC-009 | #41   |
| INFRA-003 | #32   | DECISION-001 | #43   | VTC-010 | #42   |
|           |       | DECISION-002 | #44   |         |       |

- `epics.md` — les 16 Epics.
- `tickets/` — lot 1 (Foundation / Automation), au format `docs/process/tickets.md`.

## Lot 1 — ordre proposé

| #   | Ticket    | Titre                                                  | Epic | Risque | Humain  | Dépend de        | Statut                          |
| --- | --------- | ------------------------------------------------------ | ---- | ------ | ------- | ---------------- | ------------------------------- |
| 1   | VTC-001   | Initialiser git et le repository GitHub                | 01   | MEDIUM | fait    | —                | DONE                            |
| 2   | VTC-002   | Scaffold Next.js / TypeScript strict / pnpm / Node LTS | 01   | LOW    | non     | VTC-001          | DONE                            |
| 3   | VTC-003   | ESLint, Prettier et frontières d'import                | 01   | LOW    | non     | VTC-002          | DONE                            |
| 4   | VTC-004   | Vitest et premiers tests                               | 01   | LOW    | non     | VTC-002          | DONE                            |
| 5   | VTC-005   | Configuration d'environnement validée par Zod          | 01   | MEDIUM | non     | VTC-002          | DONE                            |
| 6   | INFRA-001 | Workflow CI de base                                    | 03   | MEDIUM | non     | VTC-003, VTC-004 | DONE                            |
| 7   | INFRA-002 | Scans secrets et dépendances                           | 03   | MEDIUM | non     | INFRA-001        | DONE                            |
| 8   | VTC-006   | Branch protection et CODEOWNERS                        | 03   | HIGH   | **oui** | INFRA-001        | NEEDS_DECISION (DEC-23)         |
| 9   | VTC-007   | Templates Issues/PR et labels                          | 02   | LOW    | non     | VTC-001          | DONE                            |
| 10  | VTC-008   | Permissions Claude Code du projet                      | 02   | HIGH   | **oui** | VTC-002          | DONE                            |
| 11  | VTC-009   | Subagents Planner / Developer / Reviewer               | 02   | MEDIUM | non     | VTC-008          | REVIEW                          |
| 12  | VTC-010   | Importer le backlog dans GitHub Issues                 | 02   | LOW    | non     | VTC-007          | DONE                            |
| 13  | INFRA-003 | Claude GitHub Action (review + @claude)                | 02   | HIGH   | **oui** | VTC-006, VTC-009 | NEEDS_DECISION (DEC-17, DEC-18) |

Parallélisable : {VTC-003, VTC-004, VTC-005} après VTC-002 ; {VTC-007, VTC-010} en parallèle de la chaîne CI.

## Lot 2 (à planifier après le lot 1)

Socle Prisma + Docker Compose PostgreSQL + logger pino + health endpoint · auth admin Better Auth + 2FA · design system tokens · next-intl et squelette de routes.
