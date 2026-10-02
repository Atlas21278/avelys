# Paiements (Stripe)

Source : Master Spec §11, §15, §21. Règles : BR-40 à BR-44. ADR-0006.

## Stratégie (bootstrap, révisable par ADR)

Une autorisation carte expire après une durée limitée (à revérifier dans la doc Stripe à l'implémentation, **jamais codée en dur**). Pour les réservations lointaines :

1. **Demande (`REQUESTED`)** — `SetupIntent` avec SCA client (`usage: 'off_session'`), Customer Stripe **créé pour ce parcours** (la réutilisation d'un Customer, réservée à un compte authentifié, est hors périmètre de VTC-031). Aucun débit. Détail : « Étape 1 : enregistrement du moyen de paiement » ci-dessous.
2. **Acceptation (`ACCEPTED`)** — `PaymentIntent` `off_session: true, confirm: true`, capture automatique, montant **figé côté serveur, contrôlé contre le snapshot** (jamais recalculé avec une règle plus récente, BR-13). Détail : « Étape 2 : débit off-session à l'acceptation » ci-dessous.
   - Succès → Payment `PAID` → Booking `CONFIRMED`.
   - Authentification requise → Payment `REQUIRES_ACTION` ; le client authentifie le paiement sur une page atteinte par un lien signé (VTC-042, « Régularisation SCA » ci-dessous), envoyé par email (VTC-044) ou copié depuis le back-office ; Booking reste `ACCEPTED`.
   - Échec → Payment `FAILED` ; statut visible sur le détail back-office (notification admin par email : EPIC-13) ; Booking reste `ACCEPTED` jusqu'à résolution ou annulation (délai DEC-13).
   - **Pas de relance automatique** (DEC-27) : un associé relance manuellement depuis le back-office (VTC-041), après vérification du statut Stripe.
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

Métadonnées Stripe : uniquement `flow: booking_request` ; aucune donnée personnelle hormis l'email du Customer. Le `bookingRef` n'existe pas encore à la création du SetupIntent : il est porté par le PaymentIntent (VTC-033).

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

## Étape 2 : débit off-session à l'acceptation (VTC-033)

Décision des associés : DEC-27 (relance manuelle, vérification Stripe avant toute nouvelle tentative, réservation `ACCEPTED` jusqu'au paiement réussi, lien de régularisation si SCA).

### Modèle de tentatives

- **Un seul `Payment` par réservation en V1** (celui créé à la demande, VTC-031). Toutes les tentatives de débit se font sur cette ligne : `attempt` = numéro de la tentative courante, `stripePaymentIntentId` = PaymentIntent de la tentative courante (remplacé à chaque tentative par la relance manuelle, VTC-041).
- `Booking.currentPaymentId` **ne change jamais** : la garantie « le Payment courant appartient à cette réservation » est conservée par construction. Contrôle défensif avant tout appel Stripe (`payment.bookingId = booking.id` et `booking.currentPaymentId = payment.id`), sinon aucun débit et `PAYMENT_STATE_INCONSISTENT` journalisé.
- Historique des tentatives : `AuditLog` (`payment.charge_attempt`, `payment.charge` avec l'id `pi_…`) et Stripe (métadonnées `bookingRef` + `attempt`, Customer dédié à la réservation).

### Débit (`chargeBooking`, `src/server/payments/charge-booking.ts`)

Branché sur le port après commit `onBookingAccepted(bookingId)` par la server action d'acceptation (`chargeAcceptedBooking`, `src/server/payments/index.ts`). Règles pures : `src/domain/payment/charge.ts` ; adaptateur : `src/integrations/stripe/payment-intents.ts`.

1. **Préconditions** : Booking `ACCEPTED`, Payment courant `PENDING`, `attempt = 0`, aucun PaymentIntent. Sinon **no-op idempotent** (raison journalisée avec le `bookingRef`) : un double appel ne débite jamais deux fois.
2. **Montant** = `Payment.amountCents`/`currency`, qui doivent être égaux à `Booking.totalTtcCents`/`currency` **et** au total du `pricingSnapshot` validé (`parsePricingSnapshot`), et strictement positifs. Sinon aucun débit, `PAYMENT_AMOUNT_MISMATCH` journalisé. Jamais de montant venant du navigateur (BR-12).
3. **Réservation de la tentative** (transaction courte) : `attempt` 0 → 1 et `version + 1`, conditionnés à `id`, `version`, `attempt = 0`, `PENDING`, et à la réservation toujours `ACCEPTED` ; `AuditLog` `payment.charge_attempt`. Aucune ligne modifiée → une autre exécution est en cours : no-op.
4. **Vérification Stripe préalable** : liste des PaymentIntents du Customer dédié (lecture fortement cohérente, contrairement à la Search API ; au-delà de 100, erreur technique). Un PaymentIntent `succeeded` (ou à défaut `processing`) est appliqué au lieu d'un nouveau débit.
5. **PaymentIntent** (hors transaction) : Customer et moyen de paiement du Payment, `amount`, `currency`, `payment_method_types: ['card']`, `off_session: true`, `confirm: true`, `capture_method: 'automatic'`, clé d'idempotence `booking:{bookingId}:charge:{attempt}`, métadonnées `{ bookingRef, attempt }` **uniquement** (ni description ni donnée personnelle).
6. **Application du résultat** (`applyChargeResult`, `src/server/payments/apply-charge.ts`, partagé avec les webhooks) : verrou `FOR UPDATE` sur le Payment puis la réservation, contrôle d'appartenance, de Customer et de montant, statut cible vérifié par la table des transitions Payment, écriture sous verrou optimiste (`version`), `AuditLog`. Puis, après commit, `onPaymentRequiresAction(paymentId)` si le Payment vient d'entrer en `REQUIRES_ACTION`.

| Résultat Stripe                                                                                                                                            | Payment                                  | Booking                               | Audit                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------- | ----------------------------------- |
| `succeeded`                                                                                                                                                | `PENDING → PAID`                         | `ACCEPTED → CONFIRMED` (`SYSTEM`)     | `payment.charge`, `booking.confirm` |
| Erreur carte `authentication_required`, ou `card_declined` avec `decline_code: authentication_required` (PaymentIntent revenu à `requires_payment_method`) | `→ REQUIRES_ACTION` + port après commit  | reste `ACCEPTED`                      | `payment.charge`                    |
| Autre refus (`card_declined`, `expired_card`…)                                                                                                             | `→ FAILED`                               | reste `ACCEPTED`                      | `payment.charge`                    |
| `processing`                                                                                                                                               | reste `PENDING` (id `pi_…` enregistré)   | reste `ACCEPTED` ; le webhook tranche | `payment.charge`                    |
| Erreur technique (réseau, 5xx Stripe, clé absente ou live)                                                                                                 | reste `PENDING`, `attempt = 1`, aucun id | reste `ACCEPTED`                      | `payment.charge_attempt` seul       |

- En off-session, Stripe signale une authentification requise par une **erreur carte** `authentication_required` qui porte le PaymentIntent (statut `requires_payment_method`) — vérifié dans la doc Stripe (« charge saved payment method », 2026-09) — ou par un refus « doux » : code `card_declined` avec `decline_code: authentication_required` (docs.stripe.com/declines/codes). Les deux formes mènent à `REQUIRES_ACTION` (`requiresAuthentication`, `src/domain/payment/charge.ts`), sur le chemin synchrone comme sur la relecture webhook (`last_payment_error.code` / `decline_code`) ; tout autre code de refus, y compris `authentication_not_handled`, mène à `FAILED`. Ce sont ces codes, pas le seul statut, qui distingue `REQUIRES_ACTION` de `FAILED`. Une erreur carte portant un PaymentIntent est un **résultat** ; sans PaymentIntent, c'est une erreur technique.
- Erreur technique : aucune transition, aucune relance automatique (DEC-27). La reprise est la relance manuelle (VTC-041), qui vérifie Stripe avant toute nouvelle tentative ; si le PaymentIntent avait été créé, son webhook le rattache (ci-dessous).
- Un succès sur une réservation qui n'est plus `ACCEPTED` (annulée entre-temps) enregistre le Payment `PAID` (état du PSP, BR-41) sans toucher la réservation, et journalise une erreur : remboursement manuel (DEC-05).
- Un même statut deux fois (ex. `FAILED` → `FAILED`) n'est pas une transition et ne passe pas par la table ; la table des transitions Payment de VTC-031 est **inchangée**.

### Webhooks PaymentIntent

Handlers (`createPaymentIntentWebhookHandlers`, `src/server/payments/webhook-handlers.ts`) pour `payment_intent.succeeded`, `payment_intent.payment_failed` et `payment_intent.requires_action`. `payment_intent.canceled` n'a pas de handler : enregistré sans effet (annulations : VTC-041).

- **Tolérance au désordre** : le PaymentIntent est **relu chez Stripe avant d'ouvrir la transaction** (`prepare`, jamais d'appel réseau dans la transaction) et c'est son état courant qui est appliqué, pas l'instantané de l'événement. Stripe indisponible → 500, rien d'enregistré, Stripe renvoie l'événement. Un événement déjà enregistré est reconnu avant la relecture (pas d'appel Stripe inutile).
- **Rattachement** : par `Payment.stripePaymentIntentId` ; à défaut (crash entre la création du PaymentIntent et l'étape 6), par `metadata.bookingRef` + `metadata.attempt` égal à `Payment.attempt` + même Customer, puis enregistrement de l'id. La tentative est **revérifiée sous le verrou** avant tout rattachement (`metadata.attempt` = `Payment.attempt`, sinon ignoré : une relance concurrente a pu avancer la tentative). PaymentIntent d'une tentative antérieure → ignoré ; **un succès sur une tentative antérieure** est journalisé en erreur (`alert: orphan_succeeded_payment_intent`, `bookingRef`) pour remboursement manuel (DEC-05), sans changement d'état. Aucun rattachement (PaymentIntent inconnu, autre Customer, autre flux) → ignoré, 200.
- Mêmes effets que l'étape 6. Transition absente de la table (ex. échec relu après `PAID`) → ignorée, journalisée, 200 : jamais de 500 pour un no-op métier. Un succès déjà appliqué n'est pas rejoué (même statut = aucune écriture).
- **Effets après commit** : un handler peut renvoyer un effet exécuté après le commit de la transaction de l'événement (ici `onPaymentRequiresAction`) ; son échec est journalisé et ne fait ni échouer le webhook ni changer d'état (BR-50).

### Port `onPaymentRequiresAction`

`src/server/payments/after-charge.ts` : `onPaymentRequiresAction(paymentId)`, no-op par défaut, appelé **une fois**, après commit de toute entrée en `REQUIRES_ACTION` (chemin synchrone et webhook). L'email avec lien de régularisation s'y branchera (VTC-044) ; il construit le lien avec `paymentRegularizationUrl` (page VTC-042, ci-dessous).

### Audit, logs, affichage

- `AuditLog` (acteur `SYSTEM`) : `payment.charge_attempt` (état Payment avant/après, sans id Stripe), `payment.charge` (`bookingRef`, `attempt`, statut, version, montant, devise avant/après + `paymentIntentId` après), `booking.confirm` (`bookingRef`, statut, version).
- **Exception documentée** à la règle « aucun id Stripe dans l'`AuditLog` » : l'id `pi_…` est autorisé dans `payment.charge` pour tracer chaque tentative (ni donnée carte, ni donnée personnelle, ni secret ; format `pi_…` validé). Les autres ids Stripe (Customer, SetupIntent, moyen de paiement) restent refusés.
- **Logs** : `bookingRef`, tentative, statuts, code d'erreur Stripe (`card_declined`…) et nom d'erreur uniquement ; **jamais d'id d'objet Stripe** (PaymentIntent, Customer, SetupIntent, moyen de paiement), de donnée carte ni de donnée personnelle. **Seule exception tolérée** : l'id d'événement webhook `evt_…` (`eventId`), déjà journalisé par l'endpoint depuis VTC-030 pour corréler les livraisons avec le Dashboard ; il ne désigne ni un paiement ni une personne. Il figure aussi dans le log d'échec d'un effet après commit.
- **Back-office** : le détail d'une réservation affiche le statut du Payment courant, le numéro de tentative et le montant (lus depuis `Payment`, BR-41), sans id Stripe ; en `REQUIRES_ACTION`, le lien de régularisation pour un `ADMIN` (VTC-042). Le passage `ACCEPTED → CONFIRMED` apparaît dans l'historique (acteur « Système »).

### Vérification manuelle (test mode)

Pour le propriétaire, compte Stripe en **test mode**, clés de test dans le `.env` local uniquement, `stripe listen --forward-to localhost:3000/api/webhooks/stripe` actif (voir « Webhooks en local »), `pnpm dev` :

1. Créer une demande par le formulaire public (`/reservation`, étape 1 ci-dessus) avec la carte de test choisie ci-dessous, puis l'accepter depuis `/admin/reservations/[référence]`.
2. Cartes de test (numéros de la page « Testing » de la doc Stripe, à revérifier sur `docs.stripe.com/testing`) :
   - `4242 4242 4242 4242` (succès) → Payment « Payé », réservation « Confirmée », historique « Acceptée → Confirmée » par Système ;
   - `4000 0027 6000 3184` (authentification toujours requise) → Payment « Authentification client requise », réservation « Acceptée » ;
   - `4000 0000 0000 0341` (enregistrement accepté, débits refusés) → Payment « Échec », réservation « Acceptée ».
3. Dans le Dashboard de test : un PaymentIntent par acceptation, métadonnées `bookingRef` et `attempt` seules, montant = total de la réservation. Accepter deux fois (double clic) ne crée pas de second PaymentIntent.
4. `stripe events resend <evt_id>` sur un `payment_intent.succeeded` déjà traité : 200, aucun nouvel effet.
5. Logs : aucun id `pi_`, `cus_`, `pm_`, `seti_`.

## Régularisation SCA (VTC-042)

Décision : DEC-27 (lien de régularisation si une authentification est requise). Le client authentifie **le même PaymentIntent, avec la même carte, pour le montant figé**, en ligne ; la page **n'écrit aucun statut** : `PAID`/`CONFIRMED` ou `FAILED` viennent des webhooks ci-dessus (BR-41).

### Lien signé

- Jeton (`src/domain/payment/regularization-token.ts`, pur) : `base64url("v1:{paymentId}:{attempt}")` suivi de la signature HMAC-SHA256 (43 caractères base64url), clé `PAYMENT_LINK_SECRET` (≥ 32 caractères, validée par Zod, masquée par le logger). Alphabet `[A-Za-z0-9_-]` seul (pas de point : le proxy de locale ignore les chemins à point). Comparaison en temps constant ; encodage canonique exigé (une variante d'écriture des mêmes octets est refusée).
- **Aucune migration, rien de stocké** : le jeton est lié à la **tentative**. Une relance (VTC-041) incrémente `Payment.attempt` et rend inutilisables les liens précédents.
- **Validité liée à l'état, aucune durée inventée** (`isRegularizationLinkUsable`, `src/domain/payment/regularization.ts`) : le Payment existe, est le Payment courant de sa réservation, a le même `attempt`, est `REQUIRES_ACTION` avec un PaymentIntent, la réservation est `ACCEPTED` et la prise en charge est dans le futur. Une échéance absolue s'ajoutera avec DEC-13 (hors périmètre).
- Tout refus (jeton altéré ou d'une autre clé, autre tentative, Payment non courant, statut différent, réservation non `ACCEPTED`, prise en charge passée, `PAYMENT_LINK_SECRET` absent) → **la même page 404 générique** « Lien invalide ou expiré », sans raison affichée et sans appel Stripe (pas d'oracle). La raison est journalisée côté serveur (`bookingRef` si connu), jamais le jeton.
- Générateur : `paymentRegularizationUrl(paymentId, attempt, locale)` (`src/server/payments/regularization-link.ts`), à partir d'`APP_URL`. Sans `PAYMENT_LINK_SECRET` : aucun lien (null), erreur de configuration journalisée par nom de variable, jamais de valeur.

### Page client

- Routes : `/paiement/[token]` (FR) et `/en/payment/[token]` (EN, slug traduit, DEC-21), `src/app/[locale]/paiement/[token]/`. Hors navigation, hors sitemap ; en-têtes `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow` (`next.config.ts`), plus les balises `robots` et `referrer` équivalentes. Pas d'alternates hreflang ; le lien de langue garde le jeton.
- Affichage minimal : référence publique, date et heure de prise en charge (Europe/Paris), montant TTC du Payment. Ni nom, ni adresse, ni email, ni téléphone.
- Le serveur relit chez Stripe le PaymentIntent de la tentative courante (`retrievePaymentIntentForAuthentication`, seul appel qui lit son `client_secret`) et vérifie qu'il correspond au Payment (id, test mode, Customer, `metadata.attempt`, montant, devise) ; sinon : « ne peut plus être finalisé en ligne ». Selon son état (`regularizationStep`) :

| PaymentIntent                                                                                             | Page                                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `requires_payment_method` avec `authentication_required` (l'une des deux formes), `requires_confirmation` | bouton « Authentifier le paiement » : `stripe.confirmPayment` avec le `client_secret` et le moyen de paiement enregistré |
| `requires_action`                                                                                         | même bouton : `stripe.handleNextAction`                                                                                  |
| `succeeded`, `processing`                                                                                 | « Paiement reçu », en cours de confirmation (webhook)                                                                    |
| tout autre état                                                                                           | « Ce paiement ne peut plus être finalisé en ligne » + lien `/contact`                                                    |
| Stripe injoignable, clé publiable absente                                                                 | « Paiement momentanément indisponible »                                                                                  |

- Méthode Stripe.js reprise de la doc Stripe (« Save and reuse », vérifiée le 2026-10-02) : après un refus `authentication_required`, confirmer le PaymentIntent refusé avec son `client_secret` via `confirmPayment`. Le moyen de paiement enregistré (`Payment.stripePaymentMethodId`) est passé explicitement (`confirmParams.payment_method`) ; `redirect: "if_required"` (une carte ne redirige pas, la fenêtre 3-D Secure s'ouvre dans la page) ; `return_url` = accueil du site, jamais le lien. Aucun champ carte, aucun montant venant du navigateur (BR-12). Clé `pk_test_` seulement (garde VTC-030).
- Le résultat affiché par le navigateur est indicatif : la réservation passe `CONFIRMED` à la réception de `payment_intent.succeeded` (ou le Payment `FAILED` sur `payment_intent.payment_failed`, par exemple une authentification refusée). Une fois le Payment sorti de `REQUIRES_ACTION`, le lien répond « invalide ou expiré ».
- **Rate limiting** de la route : relève d'INFRA-005 (#67), comme les autres routes publiques ; le jeton n'est pas devinable, la limite protège la base et Stripe.

### Back-office

Sur le détail d'une réservation, pour un `ADMIN` et un Payment courant `REQUIRES_ACTION` dont le lien est utilisable : bloc « Authentification du client requise » avec le lien (dans la langue du contact de la réservation) et un bouton « Copier le lien de régularisation », pour le transmettre à la main si l'email (VTC-044) échoue. `backOfficeRegularizationLink` revérifie le rôle (`ADMIN`, 2FA) et toutes les conditions du lien. `DISPATCHER` : pas de lien. Sans `PAYMENT_LINK_SECRET` : mention « lien indisponible ».

### Rotation de `PAYMENT_LINK_SECRET`

Changer la valeur invalide **tous** les liens en circulation (aucune clé précédente acceptée). Procédure : remplacer la valeur dans le secret manager, redéployer, puis copier un nouveau lien depuis le back-office pour chaque Payment `REQUIRES_ACTION` encore utile (ou le renvoyer par email, VTC-044).

### Vérification manuelle de la régularisation (test mode)

Prérequis de l'étape 2 (clés de test, `stripe listen`), plus `PAYMENT_LINK_SECRET` dans le `.env` local :

1. Créer une demande avec la carte `4000 0027 6000 3184` (authentification toujours requise), l'accepter : Payment « Authentification client requise ».
2. Sur le détail back-office (compte `ADMIN`), copier le lien de régularisation et l'ouvrir dans une fenêtre privée : référence, date, montant, bouton « Authentifier le paiement ».
3. Valider l'authentification dans la fenêtre de test Stripe : « Paiement reçu » ; le webhook `payment_intent.succeeded` passe le Payment « Payé » et la réservation « Confirmée » (historique : « Acceptée → Confirmée » par Système).
4. Rouvrir le lien : « Lien invalide ou expiré » (404). Variante : échouer l'authentification → message d'échec, puis Payment « Échec » par webhook.
5. Logs : ni jeton, ni URL de lien, ni `client_secret`, ni id Stripe.

## Idempotence

- Chaque appel Stripe créateur (`PaymentIntent`, `Refund`) porte une `idempotencyKey` dérivée de l'identité métier (ex. `booking:{id}:charge:{attempt}`).
- Webhooks : endpoint dédié `/api/webhooks/stripe`, corps brut, signature vérifiée, `event.id` persisté (table `ProcessedWebhookEvent`, unique) avant traitement ; un événement déjà vu renvoie 200 sans effet.
- Traitement tolérant au désordre : relire l'objet Stripe si nécessaire plutôt que se fier à l'ordre d'arrivée.

### Endpoint webhook (VTC-030)

`POST /api/webhooks/stripe` (`src/app/api/webhooks/stripe/route.ts`, runtime Node, jamais mis en cache). Hors authentification et hors CSRF : seule la signature Stripe fait foi.

1. Corps brut (`request.text()`) et en-tête `stripe-signature` vérifiés par `verifyWebhookEvent` (`src/integrations/stripe/webhooks.ts`) avec `STRIPE_WEBHOOK_SECRET` (tolérance par défaut du SDK, 5 minutes), puis enveloppe de l'événement validée par Zod (`id` `evt_…`, `object: "event"`, `type`, `livemode: false`, `created`, `data.object`).
2. Service `receiveStripeWebhook` / `processStripeWebhookEvent` (`src/server/payments/process-webhook.ts`) : **une transaction** qui insère `(STRIPE, event.id, event.type)` dans `ProcessedWebhookEvent` avec `ON CONFLICT DO NOTHING`, puis exécute le handler éventuel du registre `src/server/payments/webhook-handlers.ts` (événements PaymentIntent depuis VTC-033) avec le client transactionnel. Un handler qui doit lire Stripe le fait **avant** la transaction (`prepare`, VTC-033).
3. Effets externes d'un handler (email) : **après commit** (BR-50), jamais dans la transaction ; leur échec est journalisé sans faire échouer le webhook.

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
| Relecture Stripe impossible (`prepare`)      | 500 `INTERNAL_ERROR` : Stripe réessaie   | rien                                     |
| No-op métier (PaymentIntent inconnu…)        | 200                                      | une ligne, aucun autre effet             |
| `STRIPE_WEBHOOK_SECRET` absent               | 500 `WEBHOOK_NOT_CONFIGURED`, journalisé | rien                                     |

**Événements live refusés** (BR-44) : un secret de signature test et un secret live sont indiscernables, donc tout événement `livemode: true` est refusé (400, rien écrit) tant que le ticket d'activation live (`CRITICAL`) n'est pas livré.

**Taille du corps** : aucune limite applicative sur cet endpoint public ; INFRA-005 doit imposer une limite de taille du corps sur `/api/webhooks/stripe` (ingress), en plus du rate limiting.

Concurrence : le second `INSERT` attend la transaction du premier sur l'index unique ; commit → il n'insère rien (doublon) ; rollback → il traite l'événement. Logs : `eventId`, `eventType`, `correlationId`, résultat, nom d'erreur uniquement ; jamais le payload, l'en-tête de signature ni un secret.

Le statut Stripe reste séparé du statut Booking (BR-41) : un handler met à jour `Payment` (VTC-033) et ne change un Booking que par la table de transitions centrale.

### Adaptateur Stripe (VTC-030)

`src/integrations/stripe/` : `stripeClient()` (fabrique lazy : l'environnement est lu au premier usage, `pnpm build` passe sans variable Stripe), `stripeWebhooks()` (vérificateur, interface `StripeWebhookVerifier` mockable), `stripePaymentSetup()` (SetupIntent, VTC-031) et `stripePaymentIntents()` (PaymentIntent, VTC-033 : création off-session, liste par Customer, relecture ; interface `PaymentIntentGateway` mockable), soumis à la même garde test mode. Version d'API **épinglée** dans `STRIPE_API_VERSION` (`client.ts`), égale à celle du SDK installé : une montée de SDK change cette constante délibérément. Les tests unitaires ne touchent jamais le réseau Stripe.

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
