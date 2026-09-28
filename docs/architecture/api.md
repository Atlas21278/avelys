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

## Règles

- Toute entrée validée par Zod côté serveur (y compris server actions).
- Listes admin paginées, filtrage/tri côté serveur.
- Autorisation vérifiée dans `src/server/` (pas seulement dans le middleware).
- Opérations répétables idempotentes (clé d'idempotence ou contrainte unique).
- Webhooks : corps brut, signature vérifiée, `eventId` persisté avant traitement.
- OpenAPI facultatif en V1.
