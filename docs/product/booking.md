# Réservation et machine à états

Source : Master Spec §6.2–§6.3, §10, §12, §20.1, §54.4, §54.6. Règles : BR-30, BR-31, BR-34. ADR-0008.

## Parcours

1. Devis serveur (`private/docs/product/pricing.md`).
2. Formulaire : identité et coordonnées, passagers/bagages, notes, vol/train si pertinent, acceptation des conditions. Guest checkout autorisé.
3. Enregistrement du moyen de paiement (SetupIntent, `payments.md`).
4. Création du Booking `REQUESTED` + email de réception.
5. Admin accepte ou refuse.
6. Si acceptée : paiement off-session → `CONFIRMED` → affectation → rappel avant trajet → course → `COMPLETED` → facture.

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

`createBooking(input, deps)` dans `src/server/booking/create-booking.ts` crée une réservation `REQUESTED` (transition `— → REQUESTED`, acteur `CUSTOMER`). **Aucune route publique ni server action** à ce stade : le formulaire relève d'un ticket ultérieur. Câblage de production : `requestBooking()` (`src/server/booking/request-booking.ts`).

- Dépendances injectées : devis serveur (`computeQuote`, avec son routing, sa règle active, son horloge et son délai minimal), `PaymentMethodGuard`, générateur de référence, client Prisma, point d'extension `afterCommit` facultatif.
- Entrée (Zod, schéma strict) : lieux (libellé + lat/lng + `placeId` facultatif ; lat/lng = entrée de routing, jamais stockées telles quelles), heure locale Europe/Paris, passagers/bagages, client (nom, email, téléphone facultatif, langue), notes client, vol/train facultatifs (`scheduledAt` avec décalage), `termsAccepted: true` obligatoire, `displayedTotal` (montant affiché) et `paymentSetupId` opaque. Toute clé inconnue (prix, snapshot, `snapshotId`) est refusée.
- **Prix** : toujours recalculé par le serveur (BR-12). `displayedTotal` sert uniquement à la comparaison : s'il diffère du total recalculé (montant ou devise), erreur `PRICE_CHANGED` avec le nouveau prix, rien n'est écrit. Le montant, les totaux et le `PricingSnapshot` stockés sont ceux du recalcul (BR-13), validés par `parsePricingSnapshot`, avec `pricingRuleId`/`pricingRuleVersion`.
- **Coordonnées stockées = coordonnées tarifées** (VTC-035, règle 4) : la source qui fait foi pour `pickupLat`/`pickupLng`/`dropoffLat`/`dropoffLng` est l'itinéraire routier utilisé pour le prix, jamais le navigateur. L'adaptateur de routing (`computeRoute`, `src/integrations/maps`) renvoie, avec la distance et la durée, les points de départ et d'arrivée résolus par le fournisseur (`legs[0].startLocation`/`endLocation` chez Google Routes : lieu d'un `placeId`, ou coordonnées recalées sur le réseau routier). Le devis les expose (`pricedOrigin`/`pricedDestination`) et la réservation stocke exactement ceux-là. Les lat/lng soumises ne servent que d'entrée de routing quand aucun `placeId` n'est fourni ; avec un `placeId`, elles sont ignorées. Une requête forgée (prix sur A→B, coordonnées C→D) est donc **corrigée** : elle est enregistrée sur A→B. Aucun rayon de tolérance n'est nécessaire, donc aucune valeur provisoire de tolérance n'est introduite. Si le fournisseur ne renvoie pas ces points (réponse sans leg unique ou coordonnées hors bornes) : `ROUTING_PROVIDER_ERROR` → `ROUTE_UNAVAILABLE`, aucun prix, rien n'est écrit. Idem (VTC-039) si un point résolu vaut exactement (0, 0) (raison `null_island` : coordonnée manquante lue comme 0) ou sort de la zone de service `ROUTING_SERVICE_AREA` (raison `outside_service_area`). Cette zone est un **garde-fou large contre les erreurs de géocodage, pas la zone commerciale** : valeur **provisoire**, par défaut le rectangle de la France métropolitaine Corse comprise (`41,-5.5,51.5,10` = sud, ouest, nord, est en degrés), configurable, à remplacer quand la zone d'exploitation sera décidée. Le snapshot de prix conserve aussi ces points (`resolvedPoints`, VTC-039). Le libellé et le `placeId` restent ceux soumis : le libellé est un affichage, jamais une donnée de tarification ni de dispatch.
- Ordre des contrôles : entrée → droit de création (`assertCanCreateBooking("CUSTOMER")`) → devis serveur (heure locale, délai minimal `BOOKING_LEAD_TIME_TOO_SHORT`, règle active, `ROUTE_UNAVAILABLE`) → comparaison du prix → moyen de paiement → écriture.
- **Port de paiement** : `PaymentMethodGuard.hasConfirmedPaymentMethod({ paymentSetupId })` (`src/server/booking/payment-method-guard.ts`). Sans moyen de paiement confirmé : `PAYMENT_METHOD_REQUIRED`. Jusqu'à VTC-031 (SetupIntent Stripe), la production utilise `paymentMethodGuardNotConfigured`, qui refuse toujours : **aucune réservation ne peut être créée** avant ce ticket.
- **Client guest** : rapprochement par email normalisé (trim + minuscules) parmi les profils guest (`userId` nul) ; un profil existant est réutilisé tel quel (aucune fusion, nom/téléphone/langue non modifiés : un invité ne réécrit jamais un `Customer`, DEC-25) ; un profil lié à un compte n'est jamais rattaché à une demande anonyme. Un verrou consultatif PostgreSQL par email sérialise les demandes concurrentes (deux demandes simultanées pour un même email : un seul profil, deux réservations ; testé en intégration, VTC-036).
- **Contact de la réservation** (VTC-037, DEC-25) : le nom, le téléphone (facultatif) et la langue soumis sont copiés sur la `Booking` (`contactName`, `contactPhone`, `contactLocale`), même quand le profil est réutilisé. Le chauffeur appelle donc le numéro donné pour cette course, jamais un numéro plus ancien du profil. L'email reste celui du `Customer` (clé de rapprochement). Cette copie n'entre ni dans les logs ni dans l'`AuditLog` (BR-60).
- **Transaction unique** : `Customer` (créé ou réutilisé) + `Booking` + `AuditLog` (`booking.create`, `before` nul, `after` = `bookingRef`, statut, version, total, devise, version de règle ; acteur `CUSTOMER` = id du `Customer` ; `correlationId` de la requête). Un échec d'audit ou de référence n'écrit aucune ligne.
- **Référence** : `generateReference()`, nouvel essai sur violation d'unicité (`P2002` sur `reference`), au plus `MAX_REFERENCE_ATTEMPTS` (5) essais, puis `BOOKING_REFERENCE_UNAVAILABLE`.
- **Affichage back-office** (VTC-029) : le détail d'une réservation montre son contact via `resolveBookingContact` (`src/domain/booking/contact.ts`). La copie de la réservation l'emporte en bloc (nom et langue présents ; un téléphone absent reste absent, sans repli sur le profil) ; une réservation antérieure à VTC-037 (colonnes nulles) affiche le contact du `Customer`, avec une mention de la source. La liste `/admin/reservations` affiche le nom résolu de la même façon (VTC-038). `ContactLocale` est le type `Locale` des locales routées (`src/i18n/routing.ts`), source unique ; l'enum Prisma `Locale` lui reste égal (test de parité du schéma).
- **Après commit** : `afterCommit` (futur email de réception, EPIC-13) ; son échec est journalisé et n'annule ni ne fait échouer la réservation (BR-50).
- Erreurs : `BookingCreationError` (`code`, `reason` technique, `details.total` pour `PRICE_CHANGED`, `details.temporary` pour un routing indisponible), sans donnée personnelle.
- Logs : `bookingRef` et version de règle uniquement ; jamais de nom, email, téléphone, adresse ni coordonnée (BR-60).

### Journal d'audit

`writeAuditLog(tx, entry)` (`src/server/audit/audit-log.ts`) insère une ligne `AuditLog` dans la transaction de l'écriture qu'elle trace. `before`/`after` passent par une **liste blanche par action** (schémas Zod stricts) : toute clé hors liste (nom, email, téléphone, adresse) est refusée avant écriture (`INVALID_AUDIT_PAYLOAD`, message sans valeur). Une réservation y est identifiée par son `bookingRef`. Action couverte : `booking.create`.

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
