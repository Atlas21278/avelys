# Epics

Source : Master Spec §45, §46. Statut initial de tous les Epics : `BACKLOG`, sauf EPIC-01 à 03 (lot 1 en cours de préparation).

| Epic    | Titre                                 | Objectif                                                                                                                      | Dépend de                     | Décisions liées                 | Ordre (§46)   |
| ------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------- | ------------- |
| EPIC-01 | Fondation repository et documentation | Repo GitHub protégé, scaffold Next.js/TS, conventions, env, docs à jour                                                       | —                             | DEC-01b (domaine, non bloquant) | 1             |
| EPIC-02 | Automatisation Claude et connecteurs  | Rôles Planner/Developer/Reviewer, permissions, templates, Claude GitHub Action, import backlog                                | EPIC-01                       | DEC-17, DEC-18                  | 2             |
| EPIC-03 | CI/qualité/sécurité                   | CI obligatoire (lint, typecheck, tests, build, gitleaks, audit), branch protection                                            | EPIC-01                       | —                               | 1             |
| EPIC-04 | Docker/registry                       | Image multi-stage non-root, health, Trivy + SBOM, push GHCR par digest                                                        | EPIC-03, socle app (EPIC-01)  | —                               | 10            |
| EPIC-05 | Kubernetes staging + GitOps           | Chart Helm, repo `avelys-gitops`, Argo CD, staging auto-sync, migrations Job                                                  | EPIC-04, **ADR-0014 accepté** | DEC-12                          | 11            |
| EPIC-06 | Design system                         | Tokens (anthracite/ivoire/champagne), typographies, composants accessibles, `prefers-reduced-motion`                          | EPIC-01                       | — (marque Avelys décidée)       | 4             |
| EPIC-07 | Site public FR/EN                     | next-intl, routes FR/`/en`, pages §5, légal, landing pages                                                                    | EPIC-06                       | DEC-01b, 02, 08, 20, 21         | 4             |
| EPIC-08 | Maps et devis                         | Adaptateur Maps, autocomplete, route serveur, PricingRule versionnée, moteur pur, snapshot, API devis                         | Socle Prisma (EPIC-09 amorce) | DEC-03, DEC-17                  | 5             |
| EPIC-09 | Réservation/disponibilité             | Modèle Prisma, référence publique, machine à états, AuditLog, délai 12 h, parcours réservation guest, contraintes d'exclusion | EPIC-01, EPIC-08              | DEC-06, DEC-13, DEC-20          | 3 (socle) + 6 |
| EPIC-10 | Stripe                                | SetupIntent, PaymentIntent off-session, webhooks idempotents, `REQUIRES_ACTION`, remboursements manuels                       | EPIC-09                       | DEC-05, DEC-13                  | 7             |
| EPIC-11 | Chauffeurs/véhicules/planning         | CRUD ressources, indisponibilités, compatibilité, affectation, actions chauffeur                                              | EPIC-09                       | DEC-02                          | 8             |
| EPIC-12 | Dashboard                             | Auth admin Better Auth + 2FA + RBAC, vue jour, demandes, clients, paiements, PricingRules, promos, audit, mobile              | EPIC-09 à 11                  | DEC-15                          | 3 (auth) + 8  |
| EPIC-13 | Emails/factures/promos                | Templates FR/EN, Notification, rappels, PDF facture, PromoCode serveur                                                        | EPIC-10                       | DEC-04, DEC-08, DEC-19          | 9             |
| EPIC-14 | SEO/Ads/analytics                     | Metadata, hreflang, sitemap, données structurées, consentement, GA4/GTM, événements                                           | EPIC-07                       | DEC-01b                         | 13            |
| EPIC-15 | Observabilité/incidents               | Sentry, pino + correlationId, métriques, alertes, E2E/smoke                                                                   | EPIC-04                       | DEC-12                          | 12            |
| EPIC-16 | Production/backups/runbooks           | Namespace prod, promotion, backups/PITR testés, runbooks testés, légal complet                                                | EPIC-05, EPIC-15              | DEC-09, 10, 11, 14, 16          | 14            |

## Notes de planification

- L'ordre §46 place « Base Next.js/TypeScript/Prisma/PostgreSQL + auth admin » en 3ᵉ : ce socle est porté par l'amorce d'EPIC-09 (schéma Prisma minimal + Docker Compose) et d'EPIC-12 (auth admin). Planner le découpera au lot 2.
- Ne pas ouvrir des dizaines de tickets dépendants en parallèle : au plus 2 tickets `IN_PROGRESS` indépendants.
- Les développements tarifaires peuvent avancer avec les valeurs provisoires ; seule la **mise en ligne** attend DEC-03.
