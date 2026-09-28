# Paiements (Stripe)

Source : Master Spec §11, §15, §21. Règles : BR-40 à BR-44. ADR-0006.

## Stratégie (bootstrap, révisable par ADR)

Une autorisation carte expire après une durée limitée (à revérifier dans la doc Stripe à l'implémentation, **jamais codée en dur**). Pour les réservations lointaines :

1. **Demande (`REQUESTED`)** — `SetupIntent` avec SCA client (`usage: 'off_session'`), Customer Stripe créé ou réutilisé. Aucun débit.
2. **Acceptation (`ACCEPTED`)** — `PaymentIntent` `off_session: true, confirm: true`, capture automatique, montant **recalculé côté serveur depuis le snapshot**.
   - Succès → Payment `PAID` → Booking `CONFIRMED`.
   - Authentification requise → Payment `REQUIRES_ACTION` ; email au client avec lien de paiement ; Booking reste `ACCEPTED`.
   - Échec → Payment `FAILED` ; admin notifié ; Booking reste `ACCEPTED` jusqu'à résolution ou annulation (délai DEC-13).
3. **Annulation** — remboursement total ou partiel selon la politique d'annulation (**DEC-05, À VALIDER**). Tant qu'elle n'est pas validée, le remboursement est une action admin manuelle avec montant saisi et journalisé.

`AUTHORIZED` existe dans l'enum pour un usage futur (réservations proches) mais n'est pas utilisé par ce flux.

## États Payment

`PENDING` · `REQUIRES_ACTION` · `AUTHORIZED` · `PAID` · `FAILED` · `CANCELED` · `REFUNDED` · `PARTIALLY_REFUNDED`

Les transitions Payment sont centralisées comme celles de Booking. Le Booking référence le Payment courant ; il ne duplique pas son statut.

## Idempotence

- Chaque appel Stripe créateur (`PaymentIntent`, `Refund`) porte une `idempotencyKey` dérivée de l'identité métier (ex. `booking:{id}:charge:{attempt}`).
- Webhooks : endpoint dédié `/api/webhooks/stripe`, corps brut, signature vérifiée, `event.id` persisté (table `ProcessedWebhookEvent`, unique) avant traitement ; un événement déjà vu renvoie 200 sans effet.
- Traitement tolérant au désordre : relire l'objet Stripe si nécessaire plutôt que se fier à l'ordre d'arrivée.

### Endpoint webhook (VTC-030)

`POST /api/webhooks/stripe` (`src/app/api/webhooks/stripe/route.ts`, runtime Node, jamais mis en cache). Hors authentification et hors CSRF : seule la signature Stripe fait foi.

1. Corps brut (`request.text()`) et en-tête `stripe-signature` vérifiés par `verifyWebhookEvent` (`src/integrations/stripe/webhooks.ts`) avec `STRIPE_WEBHOOK_SECRET` (tolérance par défaut du SDK, 5 minutes), puis enveloppe de l'événement validée par Zod (`id` `evt_…`, `object: "event"`, `type`, `livemode`, `created`, `data.object`).
2. Service `receiveStripeWebhook` / `processStripeWebhookEvent` (`src/server/payments/process-webhook.ts`) : **une transaction** qui insère `(STRIPE, event.id, event.type)` dans `ProcessedWebhookEvent` avec `ON CONFLICT DO NOTHING`, puis exécute le handler éventuel du registre `src/server/payments/webhook-handlers.ts` (vide pour l'instant) avec le client transactionnel.
3. Effets externes d'un futur handler (email, appel Stripe) : **après commit** (BR-50), jamais dans la transaction.

| Cas                                          | Réponse                                  | Écrit                                    |
| -------------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| Événement signé, nouveau                     | 200 `{ received: true }`                 | une ligne + écritures du handler         |
| Type sans handler                            | 200                                      | une ligne                                |
| Événement déjà enregistré (rejeu, doublon)   | 200, sans effet                          | rien                                     |
| Livraisons concurrentes du même événement    | 200 pour chacune                         | une ligne, handler exécuté une fois      |
| Signature absente, invalide ou trop ancienne | 400 `INVALID_WEBHOOK_SIGNATURE`          | rien                                     |
| Corps signé mais enveloppe invalide          | 400 `INVALID_INPUT`                      | rien                                     |
| Handler (ou base) en échec                   | 500 `INTERNAL_ERROR` : Stripe réessaie   | rien (rollback) ; le renvoi est retraité |
| `STRIPE_WEBHOOK_SECRET` absent               | 500 `WEBHOOK_NOT_CONFIGURED`, journalisé | rien                                     |

Concurrence : le second `INSERT` attend la transaction du premier sur l'index unique ; commit → il n'insère rien (doublon) ; rollback → il traite l'événement. Logs : `eventId`, `eventType`, `correlationId`, résultat, nom d'erreur uniquement ; jamais le payload, l'en-tête de signature ni un secret.

Le statut Stripe reste séparé du statut Booking (BR-41) : un handler met à jour `Payment` (ticket ultérieur) et ne change un Booking que par la table de transitions centrale.

### Adaptateur Stripe (VTC-030)

`src/integrations/stripe/` : `stripeClient()` (fabrique lazy : l'environnement est lu au premier usage, `pnpm build` passe sans variable Stripe), `stripeWebhooks()` (vérificateur, interface `StripeWebhookVerifier` mockable). Version d'API **épinglée** dans `STRIPE_API_VERSION` (`client.ts`), égale à celle du SDK installé : une montée de SDK change cette constante délibérément. Les tests unitaires ne touchent jamais le réseau Stripe.

## Moyens de paiement

CB, Apple Pay, Google Pay lorsque disponibles (Payment Element). Jamais de PAN/CVC côté serveur.

## Environnements

- Dev/CI/staging : test mode uniquement. Stripe CLI pour les webhooks en local.
- Production : clés dans le secret manager ; toute modification de clés, webhooks ou logique de capture = `CRITICAL`.
- **Garde test mode (VTC-030, BR-44)** : dans **tous** les environnements, `STRIPE_SECRET_KEY` doit commencer par `sk_test_` ou `rk_test_` et `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` par `pk_test_` ; une clé live (`sk_live_`, `rk_live_`, `pk_live_`) ou d'un format inconnu est refusée par le schéma d'environnement **et** par l'adaptateur (`src/integrations/stripe/keys.ts`), sans jamais afficher la valeur. `STRIPE_WEBHOOK_SECRET` doit être un secret de signature `whsec_…`. Les trois variables sont facultatives (vides = non configuré). Activer le mode live = ticket séparé `CRITICAL`.

### Webhooks en local

Procédure avec la [Stripe CLI](https://docs.stripe.com/stripe-cli), compte Stripe en **test mode**, sans qu'aucune clé ne quitte le poste :

1. `stripe login` (une fois ; la CLI garde ses propres identifiants de test).
2. `stripe listen --forward-to localhost:3000/api/webhooks/stripe` : la CLI affiche un secret de signature `whsec_…` propre à cette session. Le copier dans `STRIPE_WEBHOOK_SECRET` du `.env` local (jamais ailleurs), puis relancer `pnpm dev`.
3. Dans un autre terminal : `stripe trigger payment_intent.succeeded` (ou tout autre type). Attendu : 200 ; une ligne `ProcessedWebhookEvent` ; un second envoi du même événement (`stripe events resend <evt_id>`) répond 200 sans nouvel effet.

Les tests d'intégration n'utilisent ni la CLI ni le réseau : ils signent des événements localement (`Stripe.webhooks.generateTestHeaderString`) avec un secret jetable généré à l'exécution.

## Facturation

Déclenchée à `COMPLETED`. PDF serveur (`@react-pdf/renderer`) : numéro, date, client, prestation, HT/TVA/TTC, mentions légales configurables. Numérotation et règles fiscales : **DEC-04**. Une facture émise est immuable.
