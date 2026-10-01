# Paiements (Stripe)

Source : Master Spec §11, §15, §21. Règles : BR-40 à BR-44. ADR-0006.

## Stratégie (bootstrap, révisable par ADR)

Une autorisation carte expire après une durée limitée (à revérifier dans la doc Stripe à l'implémentation, **jamais codée en dur**). Pour les réservations lointaines :

1. **Demande (`REQUESTED`)** — `SetupIntent` avec SCA client (`usage: 'off_session'`), Customer Stripe **créé pour ce parcours** (la réutilisation d'un Customer, réservée à un compte authentifié, est hors périmètre de VTC-031). Aucun débit. Détail : « Étape 1 : enregistrement du moyen de paiement » ci-dessous.
2. **Acceptation (`ACCEPTED`)** — `PaymentIntent` `off_session: true, confirm: true`, capture automatique, montant **recalculé côté serveur depuis le snapshot**.
   - Succès → Payment `PAID` → Booking `CONFIRMED`.
   - Authentification requise → Payment `REQUIRES_ACTION` ; email au client avec lien de paiement ; Booking reste `ACCEPTED`.
   - Échec → Payment `FAILED` ; admin notifié ; Booking reste `ACCEPTED` jusqu'à résolution ou annulation (délai DEC-13).
3. **Annulation** — remboursement total ou partiel selon la politique d'annulation (**DEC-05, À VALIDER**). Tant qu'elle n'est pas validée, le remboursement est une action admin manuelle avec montant saisi et journalisé.

`AUTHORIZED` existe dans l'enum pour un usage futur (réservations proches) mais n'est pas utilisé par ce flux.

## États Payment

`PENDING` · `REQUIRES_ACTION` · `AUTHORIZED` · `PAID` · `FAILED` · `CANCELED` · `REFUNDED` · `PARTIALLY_REFUNDED`

Les transitions Payment sont centralisées comme celles de Booking. Le Booking référence le Payment courant (`Booking.currentPaymentId`, VTC-031) ; il ne duplique pas son statut (BR-41). Modèle : `docs/architecture/database.md` (section `Payment`).

### Transitions Payment (VTC-031)

Table pure `PAYMENT_TRANSITIONS` (`src/domain/payment/transitions.ts`), testée sur toutes les paires état × état. Toute transition absente lève `InvalidPaymentTransitionError` (code `INVALID_PAYMENT_TRANSITION`). Le service appelant applique le changement et écrit l'`AuditLog` dans la même transaction.

| De                     | Vers autorisés                                               |
| ---------------------- | ------------------------------------------------------------ |
| `PENDING`              | `REQUIRES_ACTION`, `PAID`, `FAILED`, `CANCELED`              |
| `REQUIRES_ACTION`      | `PAID`, `FAILED`, `CANCELED`                                 |
| `FAILED`               | `REQUIRES_ACTION`, `PAID`, `CANCELED`                        |
| `PAID`                 | `PARTIALLY_REFUNDED`, `REFUNDED`                             |
| `PARTIALLY_REFUNDED`   | `PARTIALLY_REFUNDED` (remboursement additionnel), `REFUNDED` |
| `AUTHORIZED`           | aucune (réservé, ADR-0006)                                   |
| `CANCELED`, `REFUNDED` | aucune                                                       |

État initial : `PENDING` (moyen de paiement enregistré, rien débité). Aucun retour vers `PENDING`. Les transitions de remboursement existent dans la table, mais **aucun remboursement n'est implémenté** (DEC-05). Proposée par VTC-031, à valider en review : toute modification passe d'abord par ce tableau.

## Étape 1 : enregistrement du moyen de paiement (VTC-031)

1. **Création du SetupIntent** — `POST /api/v1/payment-setups` (`src/app/api/v1/payment-setups/route.ts` → `requestPaymentSetup`, `src/server/payments`). Entrée Zod stricte `{ "email": "…", "submissionId"?: "…" }` (email normalisé, seule donnée personnelle transmise : l'email du Customer). Les clés d'idempotence Stripe (`payment-setup:{journeyId}:customer`, `payment-setup:{journeyId}:setup-intent`) dérivent d'un identifiant de parcours : le `submissionId` du navigateur s'il est fourni (VTC-045, ci-dessous), sinon un `randomUUID` tiré par le serveur. Le serveur crée ensuite via l'adaptateur `src/integrations/stripe/setup-intents.ts` :
   - un **Customer Stripe dédié** (email, métadonnée `flow: booking_request`) ; jamais de recherche de Customer par email (sinon une carte pourrait être rattachée au Customer d'un tiers sur simple saisie d'une adresse) ;
   - un **SetupIntent** `usage: 'off_session'`, `payment_method_types: ['card']`, rattaché à ce Customer, même métadonnée. **Aucun montant, aucun débit.**
   - Réponse 200 : `{ "paymentSetup": { "clientSecret": "…" } }`, rien d'autre (`cache-control: no-store`). Le `client_secret` n'est ni stocké ni journalisé.
   - **Anti double clic (VTC-045)** : `submissionId` facultatif, UUID v4 tiré par le navigateur, un par formulaire. Deux appels avec le même `submissionId` et le même email réutilisent les mêmes clés d'idempotence : Stripe renvoie le même Customer et le même SetupIntent (un seul de chaque ; Stripe conserve une clé 24 h). Même `submissionId` avec un autre email : Stripe refuse la clé (`StripeIdempotencyError`) → 409 `PAYMENT_SETUP_CONFLICT` ; le navigateur tire un nouveau `submissionId` quand l'email change. Sans `submissionId` : un parcours neuf par appel (comportement VTC-031).
2. **Confirmation côté navigateur** — Stripe.js / Payment Element confirme le SetupIntent (SCA si la banque la demande). Le numéro de carte et le CVC ne transitent jamais par nos serveurs (BR-40). **Formulaire public (VTC-047, `docs/product/booking.md`, étape 2)** :
   - bibliothèques officielles `@stripe/stripe-js` (import `pure` : Stripe.js n'est téléchargé depuis js.stripe.com qu'à l'étape carte) et `@stripe/react-stripe-js`, adaptateur `src/integrations/stripe/browser.ts` ;
   - clé publiable `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_` uniquement) **lue par le serveur à chaque requête** et transmise à la page : jamais inlinée au build, la même image sert tous les environnements (ADR-0013). Absente : pas d'étape carte, contact proposé. L'adaptateur refuse aussi côté navigateur une clé live ou inconnue, sans l'afficher ;
   - Payment Element carte seule (comme le SetupIntent), dans la langue de la page ; `stripe.confirmSetup({ elements, redirect: "if_required", confirmParams: { return_url } })` : aucune redirection pour une carte, l'authentification forte s'ouvre dans la fenêtre Stripe. `return_url` (la page courante **sans sa query string**, qui peut contenir des adresses saisies sur l'accueil) n'est exigé par Stripe.js que pour les moyens à redirection, non proposés ; si une redirection survenait quand même, le visiteur revient sur la page de réservation sans demande envoyée ni débit ;
   - seul l'id du SetupIntent `succeeded` est lu ; une erreur `card_error` / `validation_error` affiche le message localisé de Stripe, toute autre erreur un message générique ; rien n'est envoyé à `POST /api/v1/bookings` tant que la carte n'est pas confirmée ;
   - `submissionId` et verrouillage de l'email : voir `docs/product/booking.md` (étape 2).
3. **Création de la réservation** — le formulaire envoie `paymentSetupId` (id `seti_…`) avec la demande (`POST /api/v1/bookings`, VTC-045, `docs/architecture/api.md`). `createStripePaymentMethodGuard` relit le SetupIntent chez Stripe, **Customer développé** (`expand: ['customer']`, un seul appel), et exige : format `seti_…`, non déjà utilisé (base), connu de Stripe, `livemode: false`, métadonnée du parcours, `status = succeeded`, `usage = off_session`, Customer et moyen de paiement présents, et **email du Customer = email de la demande** (normalisés trim + minuscules ; VTC-045 : un SetupIntent obtenu pour une adresse ne sert pas une demande faite sous une autre). Sinon `PAYMENT_METHOD_REQUIRED` (raison journalisée sans id ni email ; `payment_setup_email_mismatch` pour l'email). Stripe indisponible, erreur réseau, clé absente ou non test : `PaymentMethodUnavailableError` (raison seule, sans l'erreur Stripe) → 503 `PAYMENT_UNAVAILABLE`, rien n'est écrit, **aucun message ni cause Stripe** dans la réponse ou les logs. Une seconde soumission du même formulaire (même SetupIntent, même email) renvoie la réservation déjà créée : voir `docs/product/booking.md` (soumission idempotente). Puis, dans **la transaction de création** : `Payment` `PENDING` (montant TTC et devise du Booking, `stripeCustomerId`, `stripeSetupIntentId`, `stripePaymentMethodId`, `attempt = 0`), `Booking.currentPaymentId`, `AuditLog` `payment.create`. Aucun PaymentIntent (VTC-033).

Métadonnées Stripe : uniquement `flow: booking_request` ; aucune donnée personnelle hormis l'email du Customer. Le `bookingRef` n'existe pas encore à la création du SetupIntent : il sera porté par le PaymentIntent (VTC-033).

Erreurs de l'endpoint :

| Code                     | HTTP | Cause                                                                                        |
| ------------------------ | ---- | -------------------------------------------------------------------------------------------- |
| `NOT_FOUND`              | 404  | `PUBLIC_BOOKING_ENABLED` désactivé (défaut) : aucun appel Stripe                             |
| `INVALID_INPUT`          | 400  | JSON invalide, email invalide, `submissionId` non UUID v4, clé inconnue (montant, Customer…) |
| `PAYMENT_SETUP_CONFLICT` | 409  | Même `submissionId` envoyé avec un autre email (VTC-045)                                     |
| `PAYMENT_UNAVAILABLE`    | 503  | Clé Stripe absente ou non test (garde VTC-030), erreur Stripe, réponse inexploitable         |
| `INTERNAL_ERROR`         | 500  | Erreur inattendue (nom d'erreur seul dans les logs)                                          |

**Interrupteur d'exposition (VTC-045)** : `PUBLIC_BOOKING_ENABLED` (défaut `false` dans tous les environnements) ; désactivé, cet endpoint et `POST /api/v1/bookings` répondent 404 sans appel Stripe ni écriture. Le `correlationId` est toujours tiré par le serveur (l'`x-request-id` du client est ignoré).

**Pas encore de limite de débit** sur cet endpoint public (comme `POST /api/v1/quotes`) : sans `submissionId` rejoué, chaque appel crée un Customer Stripe. INFRA-005 (DEC-17) doit ajouter une limite par IP avant l'activation en production (INFRA-006).

Logs : codes et raisons uniquement ; jamais l'email, le `client_secret`, ni un id Stripe (Customer, SetupIntent, moyen de paiement).

### Vérification manuelle (test mode)

Compte Stripe en test mode, clés de test dans le `.env` local du propriétaire (jamais ailleurs), `PUBLIC_BOOKING_ENABLED=true` dans ce `.env`, `pnpm dev` :

0. Avec `PUBLIC_BOOKING_ENABLED` vide ou `false` : les deux endpoints répondent 404, rien n'apparaît dans le Dashboard Stripe.
1. `curl -X POST localhost:3000/api/v1/payment-setups -H 'content-type: application/json' -d '{"email":"test@example.com","submissionId":"<uuid v4>"}'` → 200 avec un `clientSecret`. Le même appel une seconde fois → même `clientSecret`, un seul Customer et un seul SetupIntent dans le Dashboard. Même `submissionId` avec un autre email → 409 `PAYMENT_SETUP_CONFLICT`.
2. Confirmer ce SetupIntent avec la carte de test SCA de Stripe (`4000 0025 0000 3155`, authentification requise) via Stripe.js ou le Dashboard de test ; vérifier dans le Dashboard : SetupIntent `succeeded`, `usage: off_session`, Customer dédié, **aucun paiement**.
3. `POST /api/v1/bookings` (corps : `docs/architecture/api.md`) avec l'email du point 1, `paymentSetupId` = id du SetupIntent et le `displayedTotal` d'un devis : 201, réservation `REQUESTED`, `Payment` `PENDING`. Le même corps une seconde fois → 200, même référence, rien de nouveau en base. Même `paymentSetupId` avec un autre email → 422 `PAYMENT_METHOD_REQUIRED`.
4. Avec une clé `sk_live_…` : les deux endpoints répondent 503 `PAYMENT_UNAVAILABLE`, aucun appel Stripe.

Par le formulaire public (VTC-047), avec en plus `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_…`) et la clé navigateur Maps dans le même `.env`, sur `/reservation` puis `/en/booking` :

5. Devis, coordonnées, « Saisir ma carte », carte `4242 4242 4242 4242` (date future, CVC quelconque), conditions acceptées, « Envoyer ma demande » : référence affichée ; Dashboard : SetupIntent `succeeded`, aucun paiement ; base : réservation `REQUESTED`, `Payment` `PENDING`.
6. Même parcours avec `4000 0025 0000 3155` : fenêtre d'authentification Stripe, « Complete » → référence affichée ; « Fail » → message de Stripe sous la carte, aucune réservation.
7. Double clic sur « Envoyer ma demande », puis coupure réseau (outils du navigateur, hors ligne) pendant l'envoi et nouvel essai : une seule réservation, même référence.
8. Carte enregistrée, puis modification du trajet ou de l'heure et nouveau devis : l'étape carte repart de zéro (nouveau SetupIntent dans le Dashboard).
9. `PRICE_CHANGED` : après un devis, créer une nouvelle version de `PricingRule` (back-office ou seed local), puis envoyer : nouveau prix affiché, « Accepter le nouveau prix et envoyer » obligatoire, une réservation au nouveau prix.

## Idempotence

- Chaque appel Stripe créateur (`PaymentIntent`, `Refund`) porte une `idempotencyKey` dérivée de l'identité métier (ex. `booking:{id}:charge:{attempt}`).
- Webhooks : endpoint dédié `/api/webhooks/stripe`, corps brut, signature vérifiée, `event.id` persisté (table `ProcessedWebhookEvent`, unique) avant traitement ; un événement déjà vu renvoie 200 sans effet.
- Traitement tolérant au désordre : relire l'objet Stripe si nécessaire plutôt que se fier à l'ordre d'arrivée.

### Endpoint webhook (VTC-030)

`POST /api/webhooks/stripe` (`src/app/api/webhooks/stripe/route.ts`, runtime Node, jamais mis en cache). Hors authentification et hors CSRF : seule la signature Stripe fait foi.

1. Corps brut (`request.text()`) et en-tête `stripe-signature` vérifiés par `verifyWebhookEvent` (`src/integrations/stripe/webhooks.ts`) avec `STRIPE_WEBHOOK_SECRET` (tolérance par défaut du SDK, 5 minutes), puis enveloppe de l'événement validée par Zod (`id` `evt_…`, `object: "event"`, `type`, `livemode: false`, `created`, `data.object`).
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
| Événement live (`livemode: true`), signé     | 400 `INVALID_INPUT`                      | rien                                     |
| Handler (ou base) en échec                   | 500 `INTERNAL_ERROR` : Stripe réessaie   | rien (rollback) ; le renvoi est retraité |
| `STRIPE_WEBHOOK_SECRET` absent               | 500 `WEBHOOK_NOT_CONFIGURED`, journalisé | rien                                     |

**Événements live refusés** (BR-44) : un secret de signature test et un secret live sont indiscernables, donc tout événement `livemode: true` est refusé (400, rien écrit) tant que le ticket d'activation live (`CRITICAL`) n'est pas livré.

**Taille du corps** : aucune limite applicative sur cet endpoint public ; INFRA-005 doit imposer une limite de taille du corps sur `/api/webhooks/stripe` (ingress), en plus du rate limiting.

Concurrence : le second `INSERT` attend la transaction du premier sur l'index unique ; commit → il n'insère rien (doublon) ; rollback → il traite l'événement. Logs : `eventId`, `eventType`, `correlationId`, résultat, nom d'erreur uniquement ; jamais le payload, l'en-tête de signature ni un secret.

Le statut Stripe reste séparé du statut Booking (BR-41) : un handler met à jour `Payment` (ticket ultérieur) et ne change un Booking que par la table de transitions centrale.

### Adaptateur Stripe (VTC-030)

`src/integrations/stripe/` : `stripeClient()` (fabrique lazy : l'environnement est lu au premier usage, `pnpm build` passe sans variable Stripe), `stripeWebhooks()` (vérificateur, interface `StripeWebhookVerifier` mockable). Version d'API **épinglée** dans `STRIPE_API_VERSION` (`client.ts`), égale à celle du SDK installé : une montée de SDK change cette constante délibérément. Les tests unitaires ne touchent jamais le réseau Stripe.

## Moyens de paiement

CB, Apple Pay, Google Pay lorsque disponibles (Payment Element). Jamais de PAN/CVC côté serveur. VTC-031 limite le SetupIntent au type `card` ; Apple Pay et Google Pay relèvent d'un ticket ultérieur.

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
