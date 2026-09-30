# API et contrats

Source : Master Spec §21, §18.

## Surfaces

| Surface           | Mécanisme                                                             | Auth                                             |
| ----------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| Devis public      | Route handler `POST /api/v1/quotes` (ou server action)                | Anonyme, rate-limitée, anti-spam                 |
| Réservation       | `POST /api/v1/bookings` (VTC-045, ci-dessous)                         | Anonyme (guest) ; interrupteur, INFRA-005        |
| Moyen de paiement | `POST /api/v1/payment-setups` (VTC-031, `docs/product/payments.md`)   | Anonyme ; interrupteur, INFRA-005                |
| Espace client     | Server components + actions                                           | Session `CUSTOMER`                               |
| Back-office       | Server components + actions sous `/admin`                             | Session `ADMIN`/`DISPATCHER` + 2FA               |
| Chauffeur         | Actions dédiées (démarrer/terminer/no-show)                           | Session `DRIVER`                                 |
| Webhooks          | `POST /api/webhooks/stripe` (VTC-030, `docs/product/payments.md`)     | Signature Stripe                                 |
| Authentification  | `GET/POST /api/auth/*` (Better Auth, VTC-016)                         | Rate-limitée (base), inscription publique fermée |
| Santé             | `GET /api/health` (liveness), `GET /api/health/ready` (readiness, DB) | Aucune, sans données sensibles                   |
| Tâches planifiées | `POST /api/internal/jobs/*`                                           | Jeton interne (secret K8s), réseau interne       |

Les route handlers publics sont préfixés `/api/v1` pour permettre une évolution compatible.

## Erreurs

```json
{ "error": { "code": "BOOKING_LEAD_TIME_TOO_SHORT", "message": "…", "correlationId": "01J…" } }
```

- `code` stable (SCREAMING_SNAKE_CASE), catalogué dans `src/lib/errors.ts`.
- `message` localisé et compréhensible par l'utilisateur.
- `correlationId` présent dans les logs et Sentry.
- Jamais de stack trace ni de détail interne en production.

Catalogue actuel (`src/lib/errors.ts`) : `INVALID_INPUT` (400), `BOOKING_LEAD_TIME_TOO_SHORT`, `LOCAL_TIME_NONEXISTENT`, `LOCAL_TIME_AMBIGUOUS`, `ROUTE_UNAVAILABLE`, `PAYMENT_METHOD_REQUIRED` (422), `PRICE_CHANGED`, `PAYMENT_SETUP_CONFLICT` (409, VTC-045), `NO_ACTIVE_PRICING_RULE`, `PRICING_UNAVAILABLE`, `BOOKING_REFERENCE_UNAVAILABLE`, `PAYMENT_UNAVAILABLE` (VTC-031, Stripe inutilisable), `DATABASE_UNAVAILABLE` (503), `NOT_FOUND` (404, route publique désactivée, VTC-045), `INTERNAL_ERROR` (500) ; webhook Stripe (VTC-030) : `INVALID_WEBHOOK_SIGNATURE` (400), `WEBHOOK_NOT_CONFIGURED` (500). `PRICE_CHANGED`, `PAYMENT_METHOD_REQUIRED` et `BOOKING_REFERENCE_UNAVAILABLE` sont produits par le service de création de réservation (VTC-028, `docs/product/booking.md`), exposé par `POST /api/v1/bookings` (VTC-045). La langue du `message` suit `Accept-Language` (`en*` → anglais, sinon français).

## `POST /api/v1/quotes` — devis serveur (VTC-027)

Calcule un prix côté serveur à partir d'une distance **routière** et de la `PricingRule` active à l'instant du devis, puis le fige dans un `PricingSnapshot` (ADR-0009). Le devis n'est **pas persisté** : la réservation (VTC-028) rappelle `computeQuote` et recalcule toujours (BR-12).

Appelée par l'étape 1 du parcours public (`/reservation`, VTC-046, `docs/product/booking.md`) avec un `placeId` choisi dans l'autocomplete, jamais avec un montant.

> **Pas encore de rate limiting / anti-spam.** Ticket dédié obligatoire avant toute exposition en production (INFRA-005, DEC-17) : chaque devis déclenche un appel Google Routes facturé.

Requête (JSON, schéma strict : toute clé inconnue, en particulier un montant, est refusée) :

```json
{
  "origin": { "placeId": "ChIJ…", "label": "Gare de Lyon" },
  "destination": { "lat": 49.0097, "lng": 2.5479, "label": "CDG T2" },
  "pickupLocalDateTime": "2026-10-25T14:30",
  "passengers": 2,
  "luggage": 1
}
```

- Lieu : `placeId` **ou** `lat`/`lng`, toujours avec un `label` (affichage uniquement, ni tarifé ni journalisé).
- `pickupLocalDateTime` : heure murale Europe/Paris, `YYYY-MM-DDTHH:mm`, sans décalage. Convertie en UTC via `@date-fns/tz` ; une heure inexistante (passage à l'heure d'été) ou ambiguë (passage à l'heure d'hiver) est refusée explicitement.
- Délai minimal (BR-31) : `BOOKING_MIN_LEAD_TIME_MINUTES`, **provisoire**, 720 min (12 h) par défaut, entier strictement positif (0 est refusé par la validation de l'environnement). Une prise en charge exactement à la limite est acceptée.
- Pas de maximum passagers/bagages tant que DEC-02 est ouvert.

Réponse 200 (`cache-control: no-store`) :

```json
{
  "quote": {
    "snapshotId": "…64 hex…",
    "currency": "EUR",
    "totalTtcCents": 4852,
    "totalHtCents": null,
    "vatCents": null,
    "distanceMeters": 22345,
    "durationSeconds": 1800,
    "pickupAt": "2026-10-25T13:30:00.000Z",
    "pickupLocalDateTime": "2026-10-25T14:30",
    "timeZone": "Europe/Paris",
    "quotedAt": "2026-09-28T08:00:00.000Z",
    "pricingRuleVersion": 3
  }
}
```

- HT et TVA restent `null` tant que DEC-04 (taux de TVA) est ouvert.
- `snapshotId` : SHA-256 du JSON du snapshot ; identifie ce devis chiffré exact (pas de stockage).
- `PricingSnapshot` (`src/domain/pricing/snapshot.ts`, `schemaVersion` 1) : `quotedAt`, inputs (points routés sans libellé, heure locale + fuseau + instant UTC, passagers, bagages), règle complète (id, version, configuration), route, points de départ et d'arrivée résolus par le fournisseur (`resolvedPoints`, VTC-039 : ajout rétrocompatible sans changement de `schemaVersion`, les snapshots antérieurs sans ce champ restent valides), composantes `BaseFare`, totaux TTC/HT/TVA. Sa validation recalcule le tarif de base avec sa propre règle et sa route : un snapshot incohérent est refusé.

Erreurs (aucun prix n'est produit) :

| Code                          | HTTP | Cause                                                                    |
| ----------------------------- | ---- | ------------------------------------------------------------------------ |
| `INVALID_INPUT`               | 400  | JSON invalide, schéma non respecté, clé inconnue (montant)               |
| `LOCAL_TIME_NONEXISTENT`      | 422  | Heure sautée au passage à l'heure d'été                                  |
| `LOCAL_TIME_AMBIGUOUS`        | 422  | Heure répétée au passage à l'heure d'hiver                               |
| `BOOKING_LEAD_TIME_TOO_SHORT` | 422  | Prise en charge sous le délai minimal ou passée (contact direct, DEC-20) |
| `ROUTE_UNAVAILABLE`           | 422  | Aucun itinéraire routier (ou distance nulle)                             |
| `ROUTE_UNAVAILABLE`           | 503  | Fournisseur de routing indisponible, quota, clé absente (BR-51)          |
| `NO_ACTIVE_PRICING_RULE`      | 503  | Aucune `PricingRule` en vigueur                                          |
| `PRICING_UNAVAILABLE`         | 503  | Règle stockée invalide ou montant hors plage                             |
| `DATABASE_UNAVAILABLE`        | 503  | PostgreSQL injoignable (connexion refusée, délai, pool épuisé)           |
| `INTERNAL_ERROR`              | 500  | Erreur inattendue (détail dans les logs uniquement)                      |

Ordre des contrôles : entrée → heure locale → délai → règle active → appel de routing (facturé en dernier). Logs : code, raison technique, `snapshotId`, version de règle, total, distance — jamais d'adresse, de libellé, de coordonnée ni de `placeId` (BR-60). Une erreur inattendue n'est journalisée que par son nom (`errorName`) et le `correlationId` : ni message ni stack, qui pourraient citer un lieu.

## Interrupteur des routes de réservation publiques (VTC-045)

`PUBLIC_BOOKING_ENABLED` (booléen `true`/`false`, Zod, **`false` par défaut dans tous les environnements**). Tant qu'il n'est pas `true`, `POST /api/v1/bookings` **et** `POST /api/v1/payment-setups` répondent 404 `NOT_FOUND` avant de lire le corps : aucun appel Stripe ni Maps, aucune écriture. Activé en local (`.env.example`) et en CI (tests d'intégration) ; en production uniquement par INFRA-006, après la limitation par IP et les proxys de confiance d'INFRA-005. Environnement illisible : 500, fermé. Retour arrière sans déploiement de code : repasser la variable à `false`.

Sur ces deux routes anonymes, le `correlationId` (logs, réponses, `AuditLog`) est **toujours tiré par le serveur** : l'en-tête `x-request-id` du client est ignoré (`correlationIdFrom(headers, { ignoreIncoming: true })`, `src/lib/request-context.ts`), pour qu'un client ne choisisse pas l'identifiant de sa piste d'audit. La réponse le renvoie dans `x-request-id`.

## `POST /api/v1/bookings` — demande de réservation (VTC-045)

Crée une réservation `REQUESTED` (`docs/product/booking.md`, service de création et soumission idempotente) : prix toujours recalculé par le serveur (BR-12), moyen de paiement enregistré par `payment-setups` et vérifié chez Stripe. Runtime Node, jamais mis en cache.

> **Pas de limitation par IP** ici : prérequis bloquant de l'activation en production (INFRA-005, INFRA-006).

Requête (JSON, schéma strict de `createBooking` : toute clé inconnue, un montant ou un snapshot en particulier, est refusée) :

```json
{
  "origin": { "label": "Gare de Lyon", "placeId": "ChIJ…" },
  "destination": { "label": "CDG T2", "lat": 49.0097, "lng": 2.5479 },
  "pickupLocalDateTime": "2026-10-25T14:30",
  "passengers": 2,
  "luggage": 1,
  "customer": { "name": "…", "email": "…", "phone": "+33…", "locale": "fr" },
  "customerNotes": "…",
  "transport": { "kind": "FLIGHT", "number": "AF123", "scheduledAt": "2026-10-25T14:10:00+01:00" },
  "termsAccepted": true,
  "displayedTotal": { "amountCents": 4852, "currency": "EUR" },
  "paymentSetupId": "seti_…"
}
```

- Lieu : `placeId` (lat/lng alors facultatives et ignorées) **ou** `lat`/`lng`, toujours avec un `label`, comme le devis. Le formulaire public (VTC-047) envoie le `placeId` choisi dans l'autocomplete, sans coordonnées ; la réservation stocke toujours les points de l'itinéraire tarifé (VTC-035).
- `displayedTotal` n'est qu'une comparaison avec le prix recalculé, jamais un prix.
- Appelée par l'étape 2 du parcours public (`/reservation`, VTC-047, `docs/product/booking.md`).

Réponse (`cache-control: no-store`), rien d'autre (ni prix, ni id interne, ni id Stripe) :

- **201** : réservation créée — `{ "booking": { "reference": "VTC-…", "status": "REQUESTED" } }`.
- **200** : même corps, **rejeu** d'une soumission déjà enregistrée (même `paymentSetupId`, même email normalisé), statut courant ; aucune écriture ni appel Stripe/Maps. Deux soumissions concurrentes : une réservation, deux réponses identiques (201 et 200).

Erreurs `{ "error": { "code", "message", "correlationId" } }`, message selon `Accept-Language` :

| Code                                                                                                     | HTTP | Cause                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `NOT_FOUND`                                                                                              | 404  | `PUBLIC_BOOKING_ENABLED` désactivé (défaut)                                                                                               |
| `INVALID_INPUT`                                                                                          | 400  | JSON ou schéma invalide, clé inconnue                                                                                                     |
| `LOCAL_TIME_NONEXISTENT`, `LOCAL_TIME_AMBIGUOUS`                                                         | 422  | Heure locale inexistante ou ambiguë                                                                                                       |
| `BOOKING_LEAD_TIME_TOO_SHORT`                                                                            | 422  | Délai minimal (BR-31)                                                                                                                     |
| `ROUTE_UNAVAILABLE`                                                                                      | 422  | Aucun itinéraire routier                                                                                                                  |
| `ROUTE_UNAVAILABLE`                                                                                      | 503  | Fournisseur de routing indisponible (BR-51)                                                                                               |
| `PRICE_CHANGED`                                                                                          | 409  | Prix recalculé différent ; le corps porte aussi `"total": { "amountCents", "currency" }` (nouveau TTC serveur)                            |
| `PAYMENT_METHOD_REQUIRED`                                                                                | 422  | SetupIntent absent, invalide, non confirmé, d'un autre email, ou déjà utilisé par la demande d'un autre email                             |
| `PAYMENT_UNAVAILABLE`                                                                                    | 503  | Panne Stripe, erreur réseau, clé absente ou non test, levées par le garde : **aucun message ni cause Stripe** dans la réponse ou les logs |
| `NO_ACTIVE_PRICING_RULE`, `PRICING_UNAVAILABLE`, `BOOKING_REFERENCE_UNAVAILABLE`, `DATABASE_UNAVAILABLE` | 503  | Indisponibilités serveur                                                                                                                  |
| `INTERNAL_ERROR`                                                                                         | 500  | Inattendu (nom d'erreur seul dans les logs)                                                                                               |

Ordre des contrôles : interrupteur → JSON → schéma → rejeu (`paymentSetupId`, lecture seule) → devis serveur → comparaison du prix → garde du moyen de paiement (Stripe) → transaction. Logs : code, raison technique, `bookingRef` ; jamais de nom, email, téléphone, lieu, id Stripe ni message Stripe (BR-60).

## Règles

- Toute entrée validée par Zod côté serveur (y compris server actions).
- Listes admin paginées, filtrage/tri côté serveur.
- Autorisation vérifiée dans `src/server/` (pas seulement dans le middleware).
- Opérations répétables idempotentes (clé d'idempotence ou contrainte unique).
- Webhooks : corps brut, signature vérifiée, `eventId` persisté avant traitement.
- OpenAPI facultatif en V1.
