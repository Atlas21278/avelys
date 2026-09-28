# Base de données

Source : Master Spec §20, §33.3, §37, §54.5. ADR-0007, ADR-0009, ADR-0015.

## Moteur

PostgreSQL 17 (managé en production, DEC-12), Prisma ORM 7.

### Mise en place (VTC-015)

| Élément | Choix                                                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version | PostgreSQL 17 partout (local, CI, production visée) : la 18 existe, mais les offres managées européennes proposent toutes la 17. À réévaluer avec DEC-12.                                                                             |
| Local   | `docker-compose.yml`, service `db`, port **5433** sur `127.0.0.1` (un PostgreSQL natif peut déjà occuper 5432 sur un poste Windows). Bases `avelys` (dev) et `avelys_test` (tests d'intégration), créées par `docker/postgres/init/`. |
| URL     | `127.0.0.1` plutôt que `localhost` : sous Windows, `localhost` peut viser `::1` alors que le conteneur n'écoute qu'en IPv4.                                                                                                           |
| CI      | Service `postgres:17-alpine` du job `ci` ; `prisma migrate deploy`, contrôle de dérive, puis tests d'intégration.                                                                                                                     |
| Client  | Générateur `prisma-client`, sortie `src/generated/prisma` (ignorée par git), régénérée au `postinstall`. Adaptateur `@prisma/adapter-pg`. Instance unique par processus : `db()` dans `src/server/db.ts`.                             |
| Config  | `prisma.config.ts` lit `DATABASE_URL` directement : `prisma generate` fonctionne sans base (build Docker), les commandes de migration échouent clairement si l'URL manque.                                                            |

Contrôle de dérive en CI : `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` échoue (code 2) si le schéma contient un changement sans migration. L'extension `btree_gist`, créée en SQL manuel, ne provoque pas de faux positif (vérifié).

## Entités minimales

| Entité                                      | Responsabilité                     | Notes                                                                         |
| ------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| `User`                                      | Identité / auth                    | Tables Better Auth (session, account, verification, twoFactor) associées      |
| `Customer`                                  | Profil client                      | Peut exister sans `User` (guest checkout)                                     |
| `Company`, `CompanyMember`                  | B2B futur                          | Préparées, peu utilisées en V1                                                |
| `Driver`                                    | Chauffeur                          | `declaredStatus`, langues, véhicule préféré, lien `User`                      |
| `Vehicle`                                   | Véhicule                           | `status` stocké (`AVAILABLE`/`MAINTENANCE`/`UNAVAILABLE`) ; `ON_TRIP` calculé |
| `DriverAvailability`, `VehicleAvailability` | Créneaux d'indisponibilité datés   | `tstzrange` ou `startsAt`/`endsAt` UTC                                        |
| `Booking`                                   | Réservation + snapshot tarifaire   | voir `docs/product/booking.md`                                                |
| `BookingStop`                               | Étapes                             | ordre, adresse                                                                |
| `Payment`                                   | État + références Stripe           | `stripePaymentIntentId`, `stripeSetupIntentId`, montant centimes              |
| `Refund`                                    | Remboursements                     | montant, motif, acteur                                                        |
| `Invoice`                                   | Facture immuable                   | numéro (DEC-04), snapshot légal                                               |
| `PromoCode` (+ `PromoRedemption`)           | Promotions                         | compteur d'utilisations transactionnel                                        |
| `PricingRule`                               | Configuration tarifaire versionnée | jamais modifiée en place : nouvelle version                                   |
| `Address`                                   | Adresse normalisée                 | libellé, lat/lng, placeId                                                     |
| `Notification`                              | Envoi/état                         | canal, template, statut, erreurs                                              |
| `AuditLog`                                  | Traçabilité                        | acteur, entité, avant, après, horodatage, correlationId                       |
| `ProcessedWebhookEvent`                     | Idempotence webhooks               | `provider` + `eventId` unique                                                 |
| `RecurringBooking`                          | Récurrence future                  | structure seulement                                                           |

## Conventions

- Clés primaires : `cuid2`/`uuid` (jamais exposées comme référence publique de réservation).
- Horodatages `timestamptz` UTC ; la date/heure locale saisie est aussi stockée pour le Booking.
- Montants : `Int` centimes + `currency` `CHAR(3)`.
- Snapshots : `Json` validé par un schéma Zod versionné (`schemaVersion`).
- Enums Prisma pour tous les statuts.
- Suppression logique uniquement si justifiée ; suppression RGPD = anonymisation documentée.

## SQL hors Prisma (documenté ici, obligatoire)

Ajouté manuellement dans le fichier `migration.sql` concerné :

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
  ADD CONSTRAINT booking_driver_no_overlap
  EXCLUDE USING gist (
    "driverId" WITH =,
    tstzrange("blockedFrom", "blockedUntil", '[)') WITH &&
  )
  WHERE ("driverId" IS NOT NULL
         AND status NOT IN ('REFUSED','CANCELLED','NO_SHOW','COMPLETED'));

ALTER TABLE "Booking"
  ADD CONSTRAINT booking_vehicle_no_overlap
  EXCLUDE USING gist (
    "vehicleId" WITH =,
    tstzrange("blockedFrom", "blockedUntil", '[)') WITH &&
  )
  WHERE ("vehicleId" IS NOT NULL
         AND status NOT IN ('REFUSED','CANCELLED','NO_SHOW','COMPLETED'));
```

`blockedFrom`/`blockedUntil` sont calculés par le service à l'affectation (buffer inclus). Esquisse indicative : le ticket d'implémentation fixe les noms exacts. Un test d'intégration sur vrai PostgreSQL doit prouver le rejet (`23P01`).

> Prisma peut signaler ces contraintes comme drift : le ticket doit vérifier le comportement de `prisma migrate diff` en CI et documenter la parade.

## Migrations

- Créées en dev (`prisma migrate dev`), revues en PR (CODEOWNERS), appliquées en staging/prod par un Job `prisma migrate deploy` one-shot et observable.
- Aucune migration destructive automatique en prod ; expand → migrate → contract pour tout changement risqué.
- Compatibles avec un rolling deployment (ancienne et nouvelle version de l'app fonctionnent sur le schéma intermédiaire).
- Backup/PITR vérifié avant tout changement critique. Un rollback de code ne rollbacke pas une migration.
