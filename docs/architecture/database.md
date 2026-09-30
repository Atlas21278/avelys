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

### Authentification (VTC-016)

Migration `20260928065414_auth_better_auth`, **additive** (un enum, six tables, aucune modification de l'existant) : `User` (avec `role` `UserRole` et `twoFactorEnabled`), `Session`, `Account` (hash du mot de passe, fournisseur `credential`), `Verification` (défis 2FA en cours), `TwoFactor` (secret TOTP et codes de secours chiffrés par `BETTER_AUTH_SECRET`), `RateLimit`. Noms de champs imposés par Better Auth. Rollback : revert de la PR ; suppression manuelle des tables en dev uniquement (aucune donnée métier ne dépend encore de `User`).

### Réservation : `Customer`, `Booking`, `AuditLog` (VTC-026)

Migration `20260928154921_booking_customer_audit`, **additive** (quatre enums, trois tables, aucune modification de l'existant ; le champ `User.customer` est une relation inverse sans colonne). Test d'intégration : `src/server/booking/schema.int.test.ts` ; parité avec le domaine : `src/server/booking/schema.test.ts`.

| Élément              | Choix                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enums                | `BookingStatus` = `BOOKING_STATUSES` (9 états, ni `ON_TRIP` ni statut de paiement) ; `ActorType` = `BOOKING_ACTORS` ; `Locale` = `routing.locales` (`fr`, `en`) ; `TransportKind` (`FLIGHT`, `TRAIN`). Un test unitaire échoue si l'un diverge du code.                                                                                            |
| `Customer`           | `name`, `email`, `phone` (nullable : l'obligation relève de la validation du formulaire), `preferredLocale` (défaut `fr`). Existe sans `User` (guest) ; `userId` facultatif et unique, `ON DELETE SET NULL`. `email` **non unique** (index simple) : le rapprochement d'un guest qui revient appartient au service de création (VTC-028).          |
| Référence            | `reference VARCHAR(32)` unique : forme canonique de `createReference` (`VTC-XXXXXXXX`, 12 caractères). La marge couvre un changement de préfixe (DEC-22). Doublon rejeté par PostgreSQL (`P2002`), nouvel essai dans le service.                                                                                                                   |
| Lieux                | `pickup*` / `dropoff*` : libellé, `Lat`, `Lng`, `PlaceId` facultatif. Pas de table `Address` normalisée (hors périmètre).                                                                                                                                                                                                                          |
| Lat/lng              | `DOUBLE PRECISION` (`Float`) : ce ne sont pas des montants ; la précision d'un double (bien en deçà du millimètre) dépasse celle du géocodage, Google Maps renvoie des doubles, et un `Decimal` imposerait une conversion `Decimal.js` à chaque lecture sans gain. Aucun calcul de prix ne lit ces colonnes (prix = distance routière du devis).   |
| Horaires             | `pickupAt TIMESTAMPTZ(3)` = instant UTC (BR-52). `pickupLocalDateTime TIMESTAMP(0)` = date/heure murale saisie, sans décalage (lue via `getUTC*`), et `pickupTimeZone` (défaut `Europe/Paris`). Les deux lèvent l'ambiguïté des heures doublées au passage à l'heure d'hiver.                                                                      |
| Montants             | `Int` centimes (BR-10) : `totalTtcCents` obligatoire ; `totalHtCents` et `vatCents` **nullables tant que DEC-04 (TVA) est ouverte**, aucun taux dans le code. `currency CHAR(3)` (ISO 4217).                                                                                                                                                       |
| Snapshot             | `pricingSnapshot JSONB` (immuable, validé par le schéma Zod versionné du moteur, BR-13), `pricingRuleId` + `pricingRuleVersion`, clé étrangère composite vers `PricingRule(id, version)` ajoutée par VTC-025 (voir ci-dessous).                                                                                                                    |
| Vol/train (BR-34)    | `transportKind`, `transportNumber`, `transportOrigin`, `transportTerminal` (terminal ou gare), `transportScheduledAt` (heure prévue, distincte de `pickupAt`). Les mises à jour opérationnelles (suivi de vol, DEC-07) viendront avec leur ticket.                                                                                                 |
| Notes, verrou, dates | `customerNotes` / `internalNotes` séparées ; `version INT` (défaut 1, verrou optimiste incrémenté par le service) ; `createdAt`, `updatedAt`, `cancelledAt`, `completedAt`.                                                                                                                                                                        |
| Index                | `status`, `pickupAt`, `customerId` (liste admin, dispatch). `Booking.customerId` en `ON DELETE RESTRICT` : un client ayant des réservations ne se supprime pas (RGPD = anonymisation, DEC-11).                                                                                                                                                     |
| `AuditLog`           | `actorType` (`ActorType`), `actorId` (id `User` ou `Customer`, `null` pour `SYSTEM`), `entityType` + `entityId` (polymorphe, sans clé étrangère), `action`, `before` / `after` (`JSONB`, **sans PII**, BR-60), `correlationId` (≤ 128, comme `x-request-id`), `createdAt`. Index `(entityType, entityId, createdAt)`. Append-only côté applicatif. |
| Fuseau de session    | Le client Prisma ouvre chaque session avec `TimeZone=UTC` (`src/server/db.ts`) : `@prisma/adapter-pg` remplace le décalage d'un `timestamptz` par `+00:00`, donc une base réglée par défaut sur `Europe/Paris` décalerait silencieusement chaque instant. Prouvé par le test d'intégration (défaut de base forcé à un autre fuseau).               |

Champs §20.1 reportés, ajoutés plus tard par migration additive :

| Champ                                                                            | Ticket                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `driverId`, `vehicleId`, `blockedFrom`, `blockedUntil` + contraintes d'exclusion | EPIC-11 (modèles `Driver` / `Vehicle`, SQL ci-dessous) |

La référence au `Payment` courant (`currentPaymentId`) est livrée par VTC-031 (section `Payment` ci-dessous).

Rollback : revert de la PR ; les tables restent inutilisées tant qu'aucun service ne les écrit. Suppression manuelle en dev local uniquement, jamais de `DROP` ailleurs.

### Tarification : `PricingRule` versionnée (VTC-025)

Migrations `20260928160636_pricing_rule` (table, index, clé étrangère `NOT VALID`) puis `20260928160700_validate_booking_pricing_rule_fk` (`VALIDATE CONSTRAINT`), **additives**. Service : `src/server/pricing/rules.ts` ; tests d'intégration : `src/server/pricing/rules.int.test.ts`.

| Élément                     | Choix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Immuabilité                 | Une version = une ligne, **jamais modifiée ni supprimée** par le code applicatif (BR-13, ADR-0009). Une nouvelle grille = `createPricingRuleVersion`, qui écrit la version et sa ligne `AuditLog` (`pricingRule.create`, sans PII) dans une seule transaction.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Colonnes                    | `id` (cuid2 généré par Prisma, comme les autres modèles), `version INT` **unique** (globale, `max + 1`), `effectiveFrom TIMESTAMPTZ(3)` (index), `config JSONB`, `schemaVersion INT`, `createdBy` (id `User` staff, `null` pour le seed ; sans clé étrangère, comme `AuditLog.actorId`), `createdAt`.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `config`                    | Partie tarifaire de `PricingRuleConfig` uniquement (`currency`, `amountBasis`, `rounding`, montants, `timeFloor`), normalisée (valeurs par défaut appliquées). `id`, `version` et `schemaVersion` viennent des colonnes : un `config` qui les contient est rejeté. Validée par `parsePricingRule` **à l'écriture et à la lecture**.                                                                                                                                                                                                                                                                                                                                                                         |
| Règle active à T            | Parmi les versions déjà en vigueur (`effectiveFrom <= T`), **la plus récente** : `effectiveFrom` le plus tardif, égalité départagée par la `version` la plus haute. Une version programmée reste appliquée à sa date même si une version plus haute prend effet avant ; l'annuler = publier une nouvelle version au **même** `effectiveFrom`. Aucune règle : `NO_ACTIVE_PRICING_RULE`, jamais de valeur par défaut.                                                                                                                                                                                                                                                                                         |
| Config invalide             | `config` corrompu, champ en trop, `schemaVersion` inconnu : `PricingError` `INVALID_PRICING_RULE`, aucun prix (BR-51).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Concurrence                 | `version = max + 1` lu dans la transaction ; deux publications simultanées : l'index unique en laisse passer une (`P2002` pour l'autre), qui recommence avec le numéro suivant, au plus `MAX_VERSION_ATTEMPTS` (5) fois, puis `PRICING_RULE_VERSION_CONFLICT`. Jamais deux fois la même version ; publications concurrentes et épuisement des essais testés.                                                                                                                                                                                                                                                                                                                                                |
| Clé Booking                 | `Booking(pricingRuleId, pricingRuleVersion)` → `PricingRule(id, version)` (unique composite dédié), `ON DELETE RESTRICT ON UPDATE RESTRICT` : un booking référence une paire qui existe telle quelle, et une version référencée ne se supprime pas.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `NOT VALID` puis validation | La contrainte est ajoutée `NOT VALID` (verrou bref, les lignes `Booking` existantes ne sont pas parcourues), puis validée par la migration suivante (`VALIDATE CONSTRAINT` : verrou `SHARE UPDATE EXCLUSIVE`, lectures et écritures continuent). **Les deux migrations partent dans le même `prisma migrate deploy`** : le découpage n'apporte ici rien de plus qu'un `ADD CONSTRAINT` direct, et le déploiement exige `SELECT count(*) FROM "Booking"` = 0 (sinon, toute ligne orpheline fait échouer `VALIDATE` et bloque le rollout). Vrai partout aujourd'hui : aucun environnement déployé, aucun service n'écrit de booking. Le contrôle de dérive (`prisma migrate diff`) ne voit aucune différence. |
| Seed de dev                 | `pnpm db:seed` (`prisma db seed`, `prisma/seed.ts`) : publie la règle **PROVISIONAL — DEC-03** si aucune règle n'existe (idempotent). Refusé si `APP_ENV` n'est pas `local` ou `ci` (`src/server/seed-guard.ts`, test unitaire). Seul endroit, avec les fixtures de test, où figurent des montants.                                                                                                                                                                                                                                                                                                                                                                                                         |

Base de test locale existante : les anciens tests laissaient des bookings `pricingRuleId = 'test-rule'` sans règle correspondante, qui font échouer `VALIDATE`. Réinitialiser la base de test une fois (`DATABASE_URL=<URL de avelys_test> pnpm exec prisma migrate reset --force`, dev local uniquement) ; les tests d'intégration suppriment désormais leurs bookings en fin de fichier.

Rollback : revert de la PR ; la table reste inutilisée. En dev local uniquement : `ALTER TABLE "Booking" DROP CONSTRAINT "Booking_pricingRuleId_pricingRuleVersion_fkey"` puis suppression de la table.

### Idempotence des webhooks : `ProcessedWebhookEvent` (VTC-030)

Migration `20260929080000_processed_webhook_event`, **additive** (un enum `WebhookProvider` = `STRIPE`, une table, aucune modification de l'existant). Service : `src/server/payments/process-webhook.ts` ; tests d'intégration : `process-webhook.int.test.ts` et `src/app/api/webhooks/stripe/route.int.test.ts`.

| Élément     | Choix                                                                                                                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colonnes    | `id` (cuid2), `provider` (`WebhookProvider`), `eventId VARCHAR(255)` (`evt_…`), `eventType VARCHAR(255)`, `receivedAt TIMESTAMPTZ(3)` (défaut `now()`). **Aucun objet ni payload Stripe** stocké.                                         |
| Unicité     | `@@unique([provider, eventId])` : un événement n'est enregistré qu'une fois par fournisseur.                                                                                                                                              |
| Insertion   | `createMany({ skipDuplicates: true })` (`INSERT … ON CONFLICT DO NOTHING`) **dans la transaction du handler** : 0 ligne insérée = doublon, sans effet. Un handler en échec annule aussi l'insertion, et le renvoi de Stripe est retraité. |
| Concurrence | Deux livraisons simultanées : le second `INSERT` attend la transaction du premier sur l'index unique, puis n'insère rien (commit) ou traite l'événement (rollback). Prouvé par les tests d'intégration.                                   |
| Rétention   | Aucune purge pour l'instant (volume faible, lignes sans PII). Une purge éventuelle ne supprimerait que des lignes plus anciennes que la fenêtre de renvoi de Stripe : à décider avec son ticket.                                          |

Rollback : revert de la PR ; la table reste inutilisée. Suppression manuelle en dev local uniquement.

### Paiement : `Payment` (VTC-031)

Migration `20260929120000_payment`, **additive** (expand) : un enum `PaymentStatus`, une table `Payment`, une colonne **nullable** `Booking.currentPaymentId` ; aucune modification ni backfill de l'existant. Domaine : `src/domain/payment/{status,transitions}.ts` ; écriture : `createBooking` (`src/server/booking/create-booking.ts`) ; tests d'intégration : `src/server/booking/create-booking.int.test.ts`. Flux et table de transitions : `docs/product/payments.md`.

| Élément                    | Choix                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PaymentStatus`            | Les 8 valeurs de `payments.md`, dans l'ordre de `PAYMENT_STATUSES` (test de parité unitaire, comme `BookingStatus`). `AUTHORIZED` réservé, sans transition.                                                                                                                                                                          |
| Colonnes                   | `id` (cuid2), `bookingId`, `status` (défaut `PENDING`), `amountCents INT` + `currency CHAR(3)` (TTC du booking à la création, BR-10), `stripeCustomerId`, `stripeSetupIntentId`, `stripePaymentMethodId`, `stripePaymentIntentId` (nullable, VTC-033), `attempt INT` (défaut 0), `version INT` (défaut 1), `createdAt`, `updatedAt`. |
| Données carte              | **Aucune** (BR-40) : uniquement des identifiants d'objets Stripe (`VARCHAR(255)`). Ni PAN, ni CVC, ni `last4`, ni date d'expiration (test de parité sur les colonnes).                                                                                                                                                               |
| Unicité                    | `stripeSetupIntentId` unique : **un SetupIntent sert à une seule réservation**, même sous concurrence (la seconde transaction échoue en `P2002` → `PAYMENT_METHOD_REQUIRED`, tout est annulé). `stripePaymentIntentId` unique (plusieurs `NULL` admis).                                                                              |
| `Booking.currentPaymentId` | Nullable, **unique** (un Payment n'est courant que pour un booking), clé étrangère vers `Payment` `ON DELETE SET NULL ON UPDATE RESTRICT`. Le statut de paiement est lu depuis `Payment`, jamais copié sur `Booking` (BR-41). Nul seulement pour les bookings antérieurs à VTC-031.                                                  |
| `Payment.bookingId`        | Clé étrangère `ON DELETE RESTRICT ON UPDATE RESTRICT` (index) : un booking qui a des paiements ne se supprime pas. Le code applicatif ne supprime jamais un `Payment` ; le `SET NULL` du pointeur courant ne sert qu'au nettoyage des bases de dev/test.                                                                             |
| Écriture                   | Dans la transaction de création : `Booking` → `Payment` `PENDING` → `Booking.currentPaymentId` → `AuditLog` `payment.create` (`entityType` `Payment`, sans id Stripe ni PII). Le pointeur fait partie de la création : la `version` du booking reste 1.                                                                              |
| Verrou                     | `version` (verrou optimiste) et `attempt` (clé d'idempotence `booking:{id}:charge:{attempt}`) incrémentés par le service de débit (VTC-033). L'application d'un résultat de débit verrouille la ligne `Payment` puis la `Booking` (`SELECT … FOR UPDATE`) : réponse synchrone et webhook ne s'entrelacent jamais.                    |
| Tentatives (VTC-033)       | **Une seule ligne `Payment` par réservation en V1** : chaque tentative incrémente `attempt` et remplace `stripePaymentIntentId` (unique) ; `Booking.currentPaymentId` ne change jamais. L'historique des tentatives est dans l'`AuditLog` (`payment.charge_attempt`, `payment.charge` avec l'id `pi_…`). Aucune migration.           |

Nettoyage des tests d'intégration : supprimer les `Payment` avant les `Booking` (`payment.deleteMany()` puis `booking.deleteMany()`).

Rollback : revert de la PR ; la colonne et la table restent en place, ignorées par l'ancienne version. Suppression manuelle en dev local uniquement (`ALTER TABLE "Booking" DROP COLUMN "currentPaymentId"`, puis la table et l'enum), jamais de `DROP` ailleurs.

### Contact par réservation (VTC-037)

Migration `20260928224334_booking_contact`, **additive** (expand) : trois colonnes **nullables** sur `Booking`, sans valeur par défaut, sans backfill ni modification de l'existant. Décision : DEC-25 (option 1). Tests : `src/server/booking/create-booking.int.test.ts`, `src/server/admin/bookings.int.test.ts`, `src/domain/booking/contact.test.ts`.

| Élément       | Choix                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colonnes      | `contactName TEXT`, `contactPhone TEXT`, `contactLocale "Locale"` (enum existant). Écrites par `createBooking` à chaque réservation, depuis le contact soumis ; le `Customer` réutilisé n'est jamais modifié. |
| Lignes nulles | Réservations créées avant VTC-037 : les trois colonnes restent nulles et la lecture se replie sur le `Customer` (`resolveBookingContact`). Pas de backfill : le contact d'origine de ces courses est inconnu. |
| PII           | Données personnelles : jamais journalisées ni copiées dans `AuditLog` (BR-60). Relèvent de l'anonymisation RGPD au même titre que `Customer` (DEC-11).                                                        |
| Contract      | Aucun pour l'instant. Rendre les colonnes obligatoires supposerait un backfill des lignes anciennes : ticket et décision dédiés.                                                                              |

Rollback : revert du code ; les colonnes restent en place, ignorées par l'ancienne version (compatible avec un rolling deployment). Pas de `DROP COLUMN` hors dev local.

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
| `Payment`                                   | État + références Stripe           | Livré (VTC-031) : voir la section `Payment` ci-dessus                         |
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
