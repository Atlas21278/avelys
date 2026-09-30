# Réservation et machine à états

Source : Master Spec §6.2–§6.3, §10, §12, §20.1, §54.4, §54.6. Règles : BR-30, BR-31, BR-34. ADR-0008.

## Parcours

1. Devis serveur (`private/docs/product/pricing.md`).
2. Formulaire : identité et coordonnées, passagers/bagages, notes, vol/train si pertinent, acceptation des conditions. Guest checkout autorisé.
3. Enregistrement du moyen de paiement (SetupIntent, `payments.md`).
4. Création du Booking `REQUESTED` + email de réception.
5. Admin accepte ou refuse.
6. Si acceptée : paiement off-session → `CONFIRMED` → affectation → rappel avant trajet → course → `COMPLETED` → facture.

### Étape 1 du parcours public : devis (VTC-046)

Page `/reservation` (FR) et `/en/booking` (EN).

- **Interrupteur** : `PUBLIC_BOOKING_ENABLED` différent de `true` (défaut), ou environnement invalide → la page reste le placeholder (relecture de la recherche de l'accueil, aucun prix, jamais de 500). Réglages lus à chaque requête par `publicQuoteSettings()` (`src/server/public-booking.ts`).
- **Sans clé navigateur** (`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY` absente) ou clé refusée par Google : « Devis en ligne indisponible » + moyens de contact, aucun champ de devis, aucun prix.
- **Lieux** : autocomplete Places API (New) via le chargeur dynamique de Maps JavaScript (`src/integrations/maps/browser.ts`), script chargé seulement à la première saisie (≥ 3 caractères, 250 ms d'attente : réglages d'interface, pas des règles métier). Suggestions restreintes au rectangle `ROUTING_SERVICE_AREA` (même valeur provisoire que le routing, DEC-26 ; aucune autre zone), dans la langue de la page. Un jeton de session Places par session de saisie, renouvelé après chaque choix. **Seule une suggestion choisie est un lieu valable** : le texte libre venu de l'accueil pré-remplit le champ mais doit être confirmé dans la liste ; toute nouvelle frappe annule le choix.
- **Accessibilité** : combobox ARIA 1.2 avec listbox (`aria-expanded`, `aria-controls`, `aria-activedescendant`) ; flèches pour parcourir, Entrée pour choisir, Échap pour fermer, Tab sans piège ; nombre de suggestions et erreurs annoncés (`aria-live`, `role="alert"`) ; libellés et messages d'erreur par champ.
- **Requête** : `POST /api/v1/quotes` avec `placeId` + libellé (tronqué à 200 caractères), `pickupLocalDateTime` = date + heure murales Europe/Paris telles que saisies (le serveur tranche les heures inexistantes ou ambiguës), passagers (≥ 1), bagages (≥ 0). **Aucun montant n'est calculé ni envoyé par le navigateur** (BR-12). Bouton désactivé (état « en cours ») pendant l'appel ; une seconde soumission est ignorée.
- **Affichage** : total TTC du serveur (`totalTtcCents`, formaté par `src/lib/money.ts`), itinéraire (départ, destination, distance routière et durée estimée), heure de prise en charge en Europe/Paris, voyageurs. HT et TVA affichés seulement quand le serveur les fournit (nuls tant que DEC-04 est ouverte). Mention provisoire DEC-03 sous le prix. Une réponse mal formée n'affiche aucun prix.
- **Erreurs** (`src/lib/booking-quote.ts`, chaque code du devis a un message) : `BOOKING_LEAD_TIME_TOO_SHORT` → message + contact direct (téléphone/email de `site-identity` quand ils sont décidés, DEC-20, et lien vers `/contact`) ; `LOCAL_TIME_NONEXISTENT` / `LOCAL_TIME_AMBIGUOUS` → message explicite ; `ROUTE_UNAVAILABLE` 422 → « aucun itinéraire entre ces lieux » ; `ROUTE_UNAVAILABLE` 503, règle ou base indisponibles, erreur inattendue, code inconnu → « momentanément indisponible » ; `INVALID_INPUT` → vérifier la saisie ; échec réseau → message dédié. Aucun détail technique affiché.
- **Devis retenu pour l'étape 2** (VTC-047) : état client uniquement (`src/lib/quote-step-state.ts`), rien n'est persisté. Il contient la requête exacte et le devis affiché, et une empreinte (`quoteFingerprint` : lieux, heure murale, passagers, bagages, total et devis). **Toute modification d'un champ efface le devis affiché** (le prix visible correspond toujours aux champs visibles) et une réponse arrivée après une modification est ignorée. L'étape 2 reçoit le devis retenu (ou `null`) par `onQuoteChange` et doit tirer un **nouveau SetupIntent et un nouveau `submissionId`** dès que l'empreinte change après l'enregistrement de la carte (note de revue VTC-045).
- **Logs** : la page ne journalise aucune adresse, coordonnée ni `placeId` ; la route de devis n'en journalise pas non plus (BR-60). La clé navigateur n'est jamais utilisée par le serveur pour appeler Google (`docs/architecture/security.md`).
- Hors périmètre : coordonnées, paiement et envoi de la demande (VTC-047), carte, géolocalisation, limitation par IP (INFRA-005), mise en production (INFRA-006).

## États Booking

`REQUESTED` · `ACCEPTED` · `REFUSED` · `CANCELLED` · `CONFIRMED` · `DRIVER_ASSIGNED` · `IN_PROGRESS` · `NO_SHOW` · `COMPLETED`
États finaux : `REFUSED`, `CANCELLED`, `NO_SHOW`, `COMPLETED`.

## Transitions autorisées

| Depuis                         | Vers              | Déclencheur                                                             | Acteur                    |
| ------------------------------ | ----------------- | ----------------------------------------------------------------------- | ------------------------- |
| —                              | `REQUESTED`       | Demande soumise, moyen de paiement enregistré                           | Client                    |
| `REQUESTED`                    | `ACCEPTED`        | Acceptation                                                             | Admin/Dispatcher          |
| `REQUESTED`                    | `REFUSED`         | Refus (aucun débit)                                                     | Admin/Dispatcher          |
| `REQUESTED`                    | `CANCELLED`       | Annulation avant validation                                             | Client                    |
| `ACCEPTED`                     | `CONFIRMED`       | Payment `PAID`                                                          | Système (webhook/service) |
| `ACCEPTED`                     | `CANCELLED`       | Paiement non régularisé dans le délai configuré (DEC-13), ou annulation | Système / Client / Admin  |
| `CONFIRMED`                    | `DRIVER_ASSIGNED` | Affectation chauffeur + véhicule                                        | Admin/Dispatcher          |
| `CONFIRMED`, `DRIVER_ASSIGNED` | `CANCELLED`       | Annulation (remboursement selon DEC-05)                                 | Client / Admin            |
| `DRIVER_ASSIGNED`              | `CONFIRMED`       | Désaffectation                                                          | Admin/Dispatcher          |
| `DRIVER_ASSIGNED`              | `IN_PROGRESS`     | Début de course                                                         | Chauffeur                 |
| `DRIVER_ASSIGNED`              | `NO_SHOW`         | Client absent après délai d'attente (DEC-06)                            | Chauffeur / Admin         |
| `IN_PROGRESS`                  | `COMPLETED`       | Fin de course → déclenche la facture                                    | Chauffeur                 |

Toute autre transition échoue avec une erreur typée (`INVALID_BOOKING_TRANSITION`).

## Implémentation attendue

- Table de transitions unique dans `src/domain/booking/transitions.ts` (données + garde par rôle), fonction pure testée exhaustivement (toutes paires état×état).

### Module de domaine (VTC-019)

- États : `src/domain/booking/status.ts` (`BOOKING_STATUSES`, `FINAL_BOOKING_STATUSES`, `isBookingStatus`). Aucun statut de paiement ni `ON_TRIP` (calculé).
- Table et gardes : `src/domain/booking/transitions.ts` — `BOOKING_TRANSITIONS` (gelée), `canTransition`, `assertTransition`, `allowedTransitions(from, actor)`, `isFinal`, et pour la création `canCreateBooking` / `assertCanCreateBooking`.
- Acteurs techniques (`BookingActor`) : `CUSTOMER`, `ADMIN`, `DISPATCHER`, `DRIVER` (rôles RBAC, ADR-0005) et `SYSTEM` (webhook, tâche planifiée). Lecture littérale du tableau : « Client » = `CUSTOMER`, « Admin/Dispatcher » = `ADMIN` + `DISPATCHER`, « Admin » seul = `ADMIN`, « Chauffeur » = `DRIVER`, « Système » = `SYSTEM`. Un `DISPATCHER` ne peut donc ni annuler ni déclarer un `NO_SHOW` ; toute extension de droits passe d'abord par ce document.
- Refus : `InvalidBookingTransitionError` (`code: "INVALID_BOOKING_TRANSITION"`, `from` — `null` pour une création —, `to`, `actor`), sans donnée personnelle. Le mapping HTTP relève de la couche serveur.
- Hors module (préconditions du service appelant) : délais DEC-06 et DEC-13, vérification du Payment `PAID`, `AuditLog`, concurrence.
- Le service applique transition + écritures associées + `AuditLog` (acteur, avant, après, horodatage) dans **une transaction**.
- Concurrence : verrou optimiste (colonne `version`) ou `SELECT … FOR UPDATE` ; deux transitions concurrentes ne peuvent pas réussir toutes les deux.
- Les effets externes (email, Stripe) sont déclenchés après commit et sont idempotents (BR-50).

### Service de création (VTC-028)

`createBooking(input, deps)` dans `src/server/booking/create-booking.ts` crée une réservation `REQUESTED` (transition `— → REQUESTED`, acteur `CUSTOMER`). Câblage de production : `requestBooking()` (`src/server/booking/request-booking.ts`). Route publique : `POST /api/v1/bookings` (VTC-045, `docs/architecture/api.md`), via la soumission idempotente ci-dessous, derrière l'interrupteur `PUBLIC_BOOKING_ENABLED` (désactivé par défaut) ; le formulaire public relève de tickets ultérieurs.

- Dépendances injectées : devis serveur (`computeQuote`, avec son routing, sa règle active, son horloge et son délai minimal), `PaymentMethodGuard`, générateur de référence, client Prisma, point d'extension `afterCommit` facultatif.
- Entrée (Zod, schéma strict) : lieux (libellé + lat/lng + `placeId` facultatif ; lat/lng = entrée de routing, jamais stockées telles quelles), heure locale Europe/Paris, passagers/bagages, client (nom, email, téléphone facultatif, langue), notes client, vol/train facultatifs (`scheduledAt` avec décalage), `termsAccepted: true` obligatoire, `displayedTotal` (montant affiché) et `paymentSetupId` (id du SetupIntent Stripe `seti_…`, VTC-031). Toute clé inconnue (prix, snapshot, `snapshotId`) est refusée.
- **Prix** : toujours recalculé par le serveur (BR-12). `displayedTotal` sert uniquement à la comparaison : s'il diffère du total recalculé (montant ou devise), erreur `PRICE_CHANGED` avec le nouveau prix, rien n'est écrit. Le montant, les totaux et le `PricingSnapshot` stockés sont ceux du recalcul (BR-13), validés par `parsePricingSnapshot`, avec `pricingRuleId`/`pricingRuleVersion`.
- **Coordonnées stockées = coordonnées tarifées** (VTC-035, règle 4) : la source qui fait foi pour `pickupLat`/`pickupLng`/`dropoffLat`/`dropoffLng` est l'itinéraire routier utilisé pour le prix, jamais le navigateur. L'adaptateur de routing (`computeRoute`, `src/integrations/maps`) renvoie, avec la distance et la durée, les points de départ et d'arrivée résolus par le fournisseur (`legs[0].startLocation`/`endLocation` chez Google Routes : lieu d'un `placeId`, ou coordonnées recalées sur le réseau routier). Le devis les expose (`pricedOrigin`/`pricedDestination`) et la réservation stocke exactement ceux-là. Les lat/lng soumises ne servent que d'entrée de routing quand aucun `placeId` n'est fourni ; avec un `placeId`, elles sont ignorées. Une requête forgée (prix sur A→B, coordonnées C→D) est donc **corrigée** : elle est enregistrée sur A→B. Aucun rayon de tolérance n'est nécessaire, donc aucune valeur provisoire de tolérance n'est introduite. Si le fournisseur ne renvoie pas ces points (réponse sans leg unique ou coordonnées hors bornes) : `ROUTING_PROVIDER_ERROR` → `ROUTE_UNAVAILABLE`, aucun prix, rien n'est écrit. Idem (VTC-039) si un point résolu vaut exactement (0, 0) (raison `null_island` : coordonnée manquante lue comme 0) ou sort de la zone de service `ROUTING_SERVICE_AREA` (raison `outside_service_area`). Cette zone est un **garde-fou large contre les erreurs de géocodage, pas la zone commerciale** : valeur **provisoire**, par défaut le rectangle de la France métropolitaine Corse comprise (`41,-5.5,51.5,10` = sud, ouest, nord, est en degrés), configurable, à remplacer quand la zone d'exploitation sera décidée. Le snapshot de prix conserve aussi ces points (`resolvedPoints`, VTC-039). Le libellé et le `placeId` restent ceux soumis : le libellé est un affichage, jamais une donnée de tarification ni de dispatch.
- Ordre des contrôles : entrée → droit de création (`assertCanCreateBooking("CUSTOMER")`) → devis serveur (heure locale, délai minimal `BOOKING_LEAD_TIME_TOO_SHORT`, règle active, `ROUTE_UNAVAILABLE`) → comparaison du prix → moyen de paiement → écriture.
- **Moyen de paiement** (VTC-031, VTC-045) : `PaymentMethodGuard.confirmedPaymentMethod({ paymentSetupId, email })` (`src/server/booking/payment-method-guard.ts`) renvoie les références Stripe du moyen de paiement confirmé, ou `null` → `PAYMENT_METHOD_REQUIRED`, rien n'est écrit. En production, `createStripePaymentMethodGuard` **relit le SetupIntent chez Stripe** (jamais la parole du navigateur) et exige : id au format `seti_…`, SetupIntent pas encore utilisé par une réservation, connu de Stripe, test mode, créé par le parcours de réservation (métadonnée `flow`), `status = succeeded`, `usage = off_session`, Customer et moyen de paiement présents, **email du Customer Stripe = email de la demande** (normalisés trim + minuscules ; sinon raison `payment_setup_email_mismatch`, journalisée sans valeur). Un même SetupIntent ne sert qu'à une réservation : contrôle préalable en base **et** contrainte unique `Payment.stripeSetupIntentId` dans la transaction (deux demandes concurrentes : la seconde échoue en `PAYMENT_METHOD_REQUIRED`, raison `payment_setup_already_used`, tout est annulé). Stripe indisponible, erreur réseau, clé de test absente ou non test : pas un refus mais `PAYMENT_UNAVAILABLE` (temporaire, 503), avec la seule raison technique, jamais le message ni la cause Stripe (VTC-045) ; toute autre erreur est propagée. Détail du flux : `docs/product/payments.md`.
- **Client guest** : rapprochement par email normalisé (trim + minuscules) parmi les profils guest (`userId` nul) ; un profil existant est réutilisé tel quel (aucune fusion, nom/téléphone/langue non modifiés : un invité ne réécrit jamais un `Customer`, DEC-25) ; un profil lié à un compte n'est jamais rattaché à une demande anonyme. Un verrou consultatif PostgreSQL par email sérialise les demandes concurrentes (deux demandes simultanées pour un même email : un seul profil, deux réservations ; testé en intégration, VTC-036).
- **Contact de la réservation** (VTC-037, DEC-25) : le nom, le téléphone (facultatif) et la langue soumis sont copiés sur la `Booking` (`contactName`, `contactPhone`, `contactLocale`), même quand le profil est réutilisé. Le chauffeur appelle donc le numéro donné pour cette course, jamais un numéro plus ancien du profil. L'email reste celui du `Customer` (clé de rapprochement). Cette copie n'entre ni dans les logs ni dans l'`AuditLog` (BR-60).
- **Transaction unique** : `Customer` (créé ou réutilisé) + `Booking` + `AuditLog` (`booking.create`, `before` nul, `after` = `bookingRef`, statut, version, total, devise, version de règle ; acteur `CUSTOMER` = id du `Customer` ; `correlationId` de la requête) + `Payment` `PENDING` (montant TTC et devise du booking, ids Stripe Customer/SetupIntent/PaymentMethod, VTC-031) + `Booking.currentPaymentId` + `AuditLog` `payment.create` (`bookingRef`, statut, version, montant, devise, `attempt` ; aucun id Stripe). Aucun PaymentIntent, aucun débit. Un échec d'audit, de paiement ou de référence n'écrit aucune ligne.
- **Référence** : `generateReference()`, nouvel essai sur violation d'unicité (`P2002` sur `reference`), au plus `MAX_REFERENCE_ATTEMPTS` (5) essais, puis `BOOKING_REFERENCE_UNAVAILABLE`.
- **Affichage back-office** (VTC-029) : le détail d'une réservation montre son contact via `resolveBookingContact` (`src/domain/booking/contact.ts`). La copie de la réservation l'emporte en bloc (nom et langue présents ; un téléphone absent reste absent, sans repli sur le profil) ; une réservation antérieure à VTC-037 (colonnes nulles) affiche le contact du `Customer`, avec une mention de la source. La liste `/admin/reservations` affiche le nom résolu de la même façon (VTC-038). `ContactLocale` est le type `Locale` des locales routées (`src/i18n/routing.ts`), source unique ; l'enum Prisma `Locale` lui reste égal (test de parité du schéma).
- **Après commit** : `afterCommit` (futur email de réception, EPIC-13) ; son échec est journalisé et n'annule ni ne fait échouer la réservation (BR-50).
- Erreurs : `BookingCreationError` (`code`, `reason` technique, `details.total` pour `PRICE_CHANGED`, `details.temporary` pour un routing indisponible), sans donnée personnelle.
- Logs : `bookingRef` et version de règle uniquement ; jamais de nom, email, téléphone, adresse ni coordonnée (BR-60).

### Soumission idempotente (VTC-045)

`submitBooking(input, deps)` (`src/server/booking/submit-booking.ts`, câblage `submitBookingRequest()`) enveloppe `createBooking` pour la route publique : une double soumission du formulaire ne crée jamais deux réservations et n'affiche pas d'erreur trompeuse.

- **Clé d'idempotence naturelle** : le `paymentSetupId` de la demande (un SetupIntent ne sert qu'à une réservation : contrainte unique `Payment.stripeSetupIntentId`). Aucune migration.
- **Rejeu** : après la validation de l'entrée et **avant tout devis**, si ce SetupIntent est déjà rattaché à une réservation dont le `Customer` a le même email normalisé → même réponse (`reference`, statut **courant**), `replayed: true`, **sans aucune écriture ni appel Stripe/Maps** (HTTP 200). Email différent → `PAYMENT_METHOD_REQUIRED` (raison `payment_setup_already_used`), rien n'est écrit.
- **Concurrence** : deux soumissions simultanées passent le contrôle de rejeu ; la perdante échoue sur la contrainte unique (`payment_setup_already_used`) ou sur le contrôle en base du garde, relit la réservation de la gagnante et renvoie la même réponse (même règle d'email). Une seule réservation, deux réponses 2xx identiques (201 pour la gagnante, 200 pour la perdante) ; testé en intégration.
- Logs : `bookingRef` du rejeu uniquement.

### Service de décision (VTC-032)

`acceptBooking` / `refuseBooking(reference, expectedVersion, actor, deps?)` dans `src/server/booking/decide-booking.ts` appliquent `REQUESTED → ACCEPTED` et `REQUESTED → REFUSED`.

- **Une transaction** : lecture de la réservation, `assertTransition(statut, cible, rôle)` (table du domaine, droits inchangés : `ADMIN` et `DISPATCHER`), contrôle de version, `UPDATE … WHERE id AND version AND status` avec incrément de `version`, puis `AuditLog` (`booking.accept` / `booking.refuse`, acteur `ADMIN`/`DISPATCHER` + id utilisateur, `before`/`after` = `bookingRef`, statut, version ; `correlationId`). Un échec d'audit annule tout.
- **Verrou optimiste** : le client renvoie la version affichée. Version différente → `BOOKING_CONCURRENT_UPDATE` ; statut déjà changé → `INVALID_BOOKING_TRANSITION` (le statut est contrôlé en premier). Deux décisions simultanées : l'`UPDATE` conditionnel de la seconde ne trouve plus de ligne, une seule réussit. Référence inconnue → `BOOKING_NOT_FOUND`. Rien n'est écrit dans ces cas.
- **Le service refuse aussi tout acteur hors table** (`DRIVER`, `CUSTOMER`, `SYSTEM`), même si l'appelant a omis le contrôle d'accès.
- **Refus** : aucun débit ; le moyen de paiement enregistré n'est pas utilisé. Pas de motif de refus ni d'email client (EPIC-13).
- **Port après commit** : `onBookingAccepted(bookingId)` (`src/server/booking/after-decision.ts`), appelé uniquement après le commit d'une acceptation. No-op par défaut ; le débit off-session s'y branchera (VTC-033) et devra être idempotent. Son échec est journalisé (`bookingRef`, nom d'erreur) et la réservation **reste `ACCEPTED`** (BR-50, `payments.md`).
- **Server actions** (`src/app/admin/reservations/[reference]/actions.ts`) : corps testable dans `runBookingDecision` (`src/server/booking/decision-action.ts`). À chaque appel : session, rôle `ADMIN`/`DISPATCHER` et 2FA revérifiés côté serveur (`checkAccess`), sinon `ACCESS_DENIED` sans écriture ; entrée Zod stricte (`reference` tolérante, `expectedVersion`), sinon `INVALID_INPUT`. Vérification d'`Origin` (CSRF) par Next.js. Erreurs renvoyées en `{ code, message, correlationId }` (messages français : `src/server/booking/decision-errors.ts`) ; la page est rafraîchie après chaque issue.
- **Écran** : sur le détail `/admin/reservations/[reference]`, boutons « Accepter » / « Refuser » affichés seulement si `allowedTransitions(statut, rôle)` les contient, chacun derrière une confirmation explicite. Après un conflit, le message reste affiché au-dessus de l'état rafraîchi.
- Logs : `bookingRef`, statuts, rôle et code d'erreur uniquement (BR-60).

### Journal d'audit

`writeAuditLog(tx, entry)` (`src/server/audit/audit-log.ts`) insère une ligne `AuditLog` dans la transaction de l'écriture qu'elle trace. `before`/`after` passent par une **liste blanche par action** (schémas Zod stricts) : toute clé hors liste (nom, email, téléphone, adresse) est refusée avant écriture (`INVALID_AUDIT_PAYLOAD`, message sans valeur). Une réservation y est identifiée par son `bookingRef`. Actions couvertes : `booking.create` ; `payment.create` (VTC-031 : sans id Stripe, BR-40/BR-60) ; `booking.accept` et `booking.refuse` (VTC-032, `before`/`after` limités à `bookingRef`, statut et version).

## Champs Booking indispensables

Modèle Prisma et champs reportés : `docs/architecture/database.md` (section VTC-026).

Référence publique · `customerId` · contact de la réservation (nom, téléphone, langue ; VTC-037) · pickup/dropoff (libellé + lat/lng de l'itinéraire tarifé, VTC-035) · date/heure locale + instant UTC · passagers/bagages · distance/durée du devis · montants HT/TVA/TTC (centimes) + devise · pricing snapshot · `status` · référence au `Payment` courant (statut non dupliqué) · `driverId`/`vehicleId` optionnels · champs vol/train · notes client / notes internes séparées · `createdAt`/`updatedAt`/`cancelledAt`/`completedAt`.

## Référence publique

Format `VTC-XXXXXXXX` : 8 caractères base32 Crockford (`0-9A-HJKMNP-TV-Z`, sans I/L/O/U), générés par `crypto.randomInt`/`randomBytes`, contrainte d'unicité en base, nouvel essai en cas de collision. Jamais séquentielle.

- Préfixe **provisoire** (DEC-22 ouverte : `VTC-` ou `AVL-`) : défini une seule fois, `BOOKING_REFERENCE_PREFIX` dans `src/domain/booking/reference.ts`. À modifier là, avant la première réservation réelle, si DEC-22 en décide autrement.
- Module : `src/domain/booking/reference.ts` (pur, source d'aléa injectée) — `createReference`, `formatReference`, `normalizeReference`, `isValidReference`, erreur `INVALID_BOOKING_REFERENCE`. Génération serveur : `generateReference()` de `src/server/booking/reference.ts`, branché sur `node:crypto`. `Math.random` est interdit dans `src/domain` et `src/server` (règle ESLint).
- Saisie tolérante (`normalizeReference`) : casse ignorée ; espaces et tirets retirés ; `O` lu `0`, `I` et `L` lus `1` ; préfixe facultatif. Tout autre caractère (dont `U`, lettres accentuées, ponctuation) ou une longueur différente de 8 est rejeté. `isValidReference` ne vérifie que la forme canonique stockée.
- Hors périmètre de ce module : colonne `reference` et contrainte d'unicité (modèle Booking), boucle de nouvel essai (service de création).

## Aéroports et gares

- Aéroport : numéro de vol, provenance facultative, terminal/meeting point.
- Gare : gare, train/provenance facultatifs.
- Politique d'attente et frais : DEC-06, à valider avant publication. Meet & greet et suivi de vol : DEC-07.

## Délai de réservation

Minimum 12 h (provisoire, configurable). En dessous, afficher un contact direct (téléphone/WhatsApp/email selon config).
