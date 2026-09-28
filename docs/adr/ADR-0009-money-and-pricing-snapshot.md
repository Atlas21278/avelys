# ADR-0009 — Montants en centimes et snapshot tarifaire

- **Statut** : Accepté
- **Date** : 2026-09-28
- **Source** : Master Spec §8, §20.1

## Décision

- Tous les montants : `Int` centimes + devise ISO 4217. HT/TVA/TTC séparés.
- `PricingRule` versionnée (nouvelle version plutôt que mise à jour).
- Chaque Booking stocke un `PricingSnapshot` JSON immuable validé par Zod (`schemaVersion`) : version des règles, inputs, route, composantes, totaux.
- Calcul dans une fonction pure `src/domain/pricing`, recalculé serveur avant demande et avant paiement.

## Conséquences

Un helper `money` unique (addition, pourcentage, arrondi explicite). La règle d'arrondi et l'ordre promo/majorations sont fixés et testés dans le ticket pricing (DEC-03 si une règle métier est nécessaire).
