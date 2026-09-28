# API et contrats

Source : Master Spec §21, §18.

## Surfaces

| Surface           | Mécanisme                                                             | Auth                                             |
| ----------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| Devis public      | Route handler `POST /api/v1/quotes` (ou server action)                | Anonyme, rate-limitée, anti-spam                 |
| Réservation       | Server actions / `POST /api/v1/bookings`                              | Anonyme (guest) ou session client                |
| Espace client     | Server components + actions                                           | Session `CUSTOMER`                               |
| Back-office       | Server components + actions sous `/admin`                             | Session `ADMIN`/`DISPATCHER` + 2FA               |
| Chauffeur         | Actions dédiées (démarrer/terminer/no-show)                           | Session `DRIVER`                                 |
| Webhooks          | `POST /api/webhooks/stripe`                                           | Signature Stripe                                 |
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

Catalogue actuel (`src/lib/errors.ts`) : `INVALID_INPUT` (400), `BOOKING_LEAD_TIME_TOO_SHORT`, `LOCAL_TIME_NONEXISTENT`, `LOCAL_TIME_AMBIGUOUS`, `ROUTE_UNAVAILABLE`, `PAYMENT_METHOD_REQUIRED` (422), `PRICE_CHANGED` (409), `NO_ACTIVE_PRICING_RULE`, `PRICING_UNAVAILABLE`, `BOOKING_REFERENCE_UNAVAILABLE`, `DATABASE_UNAVAILABLE` (503), `INTERNAL_ERROR` (500). `PRICE_CHANGED`, `PAYMENT_METHOD_REQUIRED` et `BOOKING_REFERENCE_UNAVAILABLE` sont produits par le service de création de réservation (VTC-028, `docs/product/booking.md`), qui n'a pas encore de route publique. La langue du `message` suit `Accept-Language` (`en*` → anglais, sinon français).

## `POST /api/v1/quotes` — devis serveur (VTC-027)

Calcule un prix côté serveur à partir d'une distance **routière** et de la `PricingRule` active à l'instant du devis, puis le fige dans un `PricingSnapshot` (ADR-0009). Le devis n'est **pas persisté** : la réservation (VTC-028) rappelle `computeQuote` et recalcule toujours (BR-12).

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
- Délai minimal (BR-31) : `BOOKING_MIN_LEAD_TIME_MINUTES`, **provisoire**, 720 min (12 h) par défaut. Une prise en charge exactement à la limite est acceptée.
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
- `PricingSnapshot` (`src/domain/pricing/snapshot.ts`, `schemaVersion` 1) : `quotedAt`, inputs (points routés sans libellé, heure locale + fuseau + instant UTC, passagers, bagages), règle complète (id, version, configuration), route, composantes `BaseFare`, totaux TTC/HT/TVA. Sa validation recalcule le tarif de base avec sa propre règle et sa route : un snapshot incohérent est refusé.

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
| `INTERNAL_ERROR`              | 500  | Erreur inattendue (détail dans les logs uniquement)                      |

Ordre des contrôles : entrée → heure locale → délai → règle active → appel de routing (facturé en dernier). Logs : code, raison technique, `snapshotId`, version de règle, total, distance — jamais d'adresse, de libellé, de coordonnée ni de `placeId` (BR-60).

## Règles

- Toute entrée validée par Zod côté serveur (y compris server actions).
- Listes admin paginées, filtrage/tri côté serveur.
- Autorisation vérifiée dans `src/server/` (pas seulement dans le middleware).
- Opérations répétables idempotentes (clé d'idempotence ou contrainte unique).
- Webhooks : corps brut, signature vérifiée, `eventId` persisté avant traitement.
- OpenAPI facultatif en V1.
