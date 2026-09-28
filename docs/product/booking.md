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
- Le service applique transition + écritures associées + `AuditLog` (acteur, avant, après, horodatage) dans **une transaction**.
- Concurrence : verrou optimiste (colonne `version`) ou `SELECT … FOR UPDATE` ; deux transitions concurrentes ne peuvent pas réussir toutes les deux.
- Les effets externes (email, Stripe) sont déclenchés après commit et sont idempotents (BR-50).

## Champs Booking indispensables

Référence publique · `customerId` · pickup/dropoff (libellé + lat/lng) · date/heure locale + instant UTC · passagers/bagages · distance/durée du devis · montants HT/TVA/TTC (centimes) + devise · pricing snapshot · `status` · référence au `Payment` courant (statut non dupliqué) · `driverId`/`vehicleId` optionnels · champs vol/train · notes client / notes internes séparées · `createdAt`/`updatedAt`/`cancelledAt`/`completedAt`.

## Référence publique

Format `VTC-XXXXXXXX` : 8 caractères base32 Crockford (`0-9A-HJKMNP-TV-Z`, sans I/L/O/U), générés par `crypto.randomInt`/`randomBytes`, contrainte d'unicité en base, nouvel essai en cas de collision. Jamais séquentielle.

## Aéroports et gares

- Aéroport : numéro de vol, provenance facultative, terminal/meeting point.
- Gare : gare, train/provenance facultatifs.
- Politique d'attente et frais : DEC-06, à valider avant publication. Meet & greet et suivi de vol : DEC-07.

## Délai de réservation

Minimum 12 h (provisoire, configurable). En dessous, afficher un contact direct (téléphone/WhatsApp/email selon config).
