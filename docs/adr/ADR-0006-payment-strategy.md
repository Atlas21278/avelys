# ADR-0006 — Stratégie de paiement Stripe

- **Statut** : Accepté (bootstrap, révisable)
- **Date** : 2026-09-28
- **Source** : Master Spec §11, §11.1

## Contexte

Réservations souvent anticipées ; une autorisation carte expire (durée à revérifier dans la doc Stripe, jamais codée en dur) ; validation manuelle avant débit.

## Décision

1. `REQUESTED` : SetupIntent avec SCA, aucun débit.
2. `ACCEPTED` : PaymentIntent off-session, capture automatique, montant recalculé serveur. Succès → `PAID` → Booking `CONFIRMED` ; action requise → `REQUIRES_ACTION` + lien au client ; échec → `FAILED` + admin notifié.
3. Annulation : remboursement selon DEC-05 (manuel tant que non validée).

- Statut Payment séparé du statut Booking. Webhooks signés, `event.id` persisté. Clés d'idempotence sur chaque création Stripe.
- `AUTHORIZED` réservé à un usage futur.

## Conséquences

Risque de refus off-session (carte expirée, SCA) géré par le flux `REQUIRES_ACTION`. Tout changement de logique de capture en prod = `CRITICAL`.

## Alternatives écartées

Autorisation puis capture différée (expiration pour les réservations lointaines) ; paiement immédiat avant validation (remboursements fréquents en cas de refus).
