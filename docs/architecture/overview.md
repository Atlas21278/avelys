# Architecture — vue d'ensemble

Source : Master Spec §19, §52, §54. Ce document est le **résumé d'architecture** du bootstrap ; il ne modifie aucune règle métier.

## Système en une phrase

Une application Next.js monolithique modulaire (UI publique, espace client, back-office, API, webhooks) sur PostgreSQL, intégrant Stripe, Google Maps et Resend, livrée en image Docker immuable via GitHub Actions → GHCR → repo GitOps → Argo CD → Kubernetes (staging puis production).

## Contexte

```
                 ┌────────────── Clients (FR/EN, mobile) ──────────────┐
                 │                                                      │
 Admin/Dispatcher/Chauffeurs ──►  avelys (Next.js, 1 image)  ◄── Stripe webhooks
                                   │   │   │   │
                     PostgreSQL ◄──┘   │   │   └──► Resend (emails FR/EN)
                     (managé, PITR)    │   └──────► Google Maps (routing, geocoding)
                                       └──────────► Stripe API (SetupIntent, PaymentIntent, Refund)
                                   │
                                   └──► Sentry, logs JSON (pino), métriques
```

## Couches logicielles

| Couche       | Dossier             | Contenu                                                                                                    | Interdits                                                         |
| ------------ | ------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Présentation | `src/app/`          | Pages, layouts, composants, server actions minces, route handlers                                          | Logique tarifaire, accès Prisma direct depuis un composant client |
| Domaine      | `src/domain/`       | Pricing, transitions Booking/Payment, compatibilité dispatch, promos, référence publique — fonctions pures | I/O, Prisma, `Date.now()` implicite (injecter l'horloge)          |
| Services     | `src/server/`       | Cas d'usage, transactions, autorisation RBAC, AuditLog, repositories Prisma                                | Appels HTTP directs (passer par `integrations/`)                  |
| Intégrations | `src/integrations/` | Adaptateurs Stripe, Maps, Resend, Sentry avec timeouts/retry                                               | Règles métier                                                     |
| Utilitaires  | `src/lib/`          | `env` (Zod), `logger` (pino), `errors`, `money`, `dates`                                                   | —                                                                 |

Internationalisation FR/EN (next-intl, `src/i18n/`, proxy `src/proxy.ts`) : `docs/architecture/i18n.md`.

Flux type (demande de réservation) : server action → validation Zod → `server/booking.requestBooking()` → `domain/pricing` recalcule → transaction (Booking `REQUESTED` + snapshot + AuditLog) → après commit : `server/notifications.sendNotification()` → `Notification` persistée → email via `integrations/email` (Resend ; échec tracé, sans effet sur la réservation, BR-50).

Emails transactionnels (Resend + React Email, `Notification`, déduplication, codes d'échec) : `docs/architecture/email.md`.

## Décisions figées (ADR)

| ADR  | Sujet                                                                          |
| ---- | ------------------------------------------------------------------------------ |
| 0001 | Utiliser des ADR                                                               |
| 0002 | Repo applicatif unique + repo GitOps séparé                                    |
| 0003 | Stack runtime et outillage (Node LTS, pnpm, Next.js, TS strict, Tailwind, Zod) |
| 0004 | Conventions (commits, branches, structure `src/`, routes i18n)                 |
| 0005 | Auth Better Auth + RBAC                                                        |
| 0006 | Stratégie de paiement Stripe SetupIntent → PaymentIntent off-session           |
| 0007 | PostgreSQL + Prisma, anti double-affectation par contrainte d'exclusion        |
| 0008 | Machine à états Booking                                                        |
| 0009 | Montants en centimes et snapshot tarifaire                                     |
| 0010 | Google Maps Platform pour le routing                                           |
| 0011 | Resend + React Email ; PDF via @react-pdf/renderer                             |
| 0012 | Stratégie de tests (Vitest, Playwright)                                        |
| 0013 | Livraison : Docker, GHCR, Helm, Argo CD                                        |
| 0014 | Hébergement européen + PostgreSQL managé (**Proposé**, DEC-12)                 |
| 0015 | Référence publique de réservation                                              |

## Environnements

| Env        | Hébergement                                      | Données                   | Stripe            |
| ---------- | ------------------------------------------------ | ------------------------- | ----------------- |
| local      | `pnpm dev` + Docker Compose PostgreSQL           | fictives                  | test + Stripe CLI |
| CI         | GitHub Actions + service PostgreSQL              | fixtures                  | mocks / test      |
| staging    | Kubernetes, namespace dédié, auto-sync Argo      | non réelles / anonymisées | test              |
| production | Kubernetes, namespace dédié, promotion contrôlée | réelles                   | live              |

## Hors périmètre technique V1

Microservices, file de messages dédiée, cache distribué, HPA par réflexe, OpenAPI public (recommandé seulement si API publique/mobile).
Les tâches différées (rappels, expiration des paiements non régularisés) utilisent un mécanisme simple à choisir en EPIC-09 (CronJob Kubernetes appelant un endpoint protégé, idempotent).
