# ADR-0008 — Machine à états Booking

- **Statut** : Accepté
- **Date** : 2026-09-28
- **Source** : Master Spec §10, §54.4

## Décision

- Table de transitions unique dans `src/domain/booking/` (voir `docs/product/booking.md`), avec acteurs autorisés.
- Transition + effets DB + `AuditLog` dans une même transaction ; contrôle de concurrence (version optimiste ou verrou de ligne).
- Transition invalide → erreur typée `INVALID_BOOKING_TRANSITION`.
- Effets externes après commit, idempotents.
- Même principe pour Payment.

## Conséquences

Pas de bibliothèque de state machine : une table de données + fonction pure suffit et reste lisible. Tests exhaustifs de toutes les paires d'états.
