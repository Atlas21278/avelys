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

## Moyens de paiement

CB, Apple Pay, Google Pay lorsque disponibles (Payment Element). Jamais de PAN/CVC côté serveur.

## Environnements

- Dev/CI/staging : test mode uniquement. Stripe CLI pour les webhooks en local.
- Production : clés dans le secret manager ; toute modification de clés, webhooks ou logique de capture = `CRITICAL`.

## Facturation

Déclenchée à `COMPLETED`. PDF serveur (`@react-pdf/renderer`) : numéro, date, client, prestation, HT/TVA/TTC, mentions légales configurables. Numérotation et règles fiscales : **DEC-04**. Une facture émise est immuable.
