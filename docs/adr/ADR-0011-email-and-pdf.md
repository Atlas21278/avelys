# ADR-0011 — Emails Resend + React Email, factures @react-pdf/renderer

- **Statut** : Accepté
- **Date** : 2026-09-28
- **Source** : Master Spec §15, §54.2

## Décision

- Resend pour l'email transactionnel, templates React Email FR/EN.
- Chaque envoi est une `Notification` persistée (statut, erreur, tentatives) ; envoi après commit ; un échec est sans effet sur la réservation.
- Factures PDF générées serveur avec `@react-pdf/renderer` ; facture immuable une fois émise ; mentions légales configurables (DEC-04, DEC-08).

## Conséquences

Domaine d’envoi à vérifier (SPF/DKIM) une fois DEC-01b tranché. Clés Resend séparées dev/staging/prod si possible.
