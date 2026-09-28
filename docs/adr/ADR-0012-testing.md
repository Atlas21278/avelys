# ADR-0012 — Stratégie de tests

- **Statut** : Accepté
- **Date** : 2026-09-28
- **Source** : Master Spec §43, §54.2

## Décision

| Type        | Outil                                          | Cible                                                                             |
| ----------- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Unitaire    | Vitest                                         | domain (pricing, transitions, dispatch, promos), lib                              |
| Intégration | Vitest + PostgreSQL réel (Docker / service CI) | services, contraintes DB, webhooks Stripe (événements signés de test), Maps mocké |
| E2E         | Playwright                                     | devis → réservation ; acceptation admin ; paiement test                           |
| Smoke       | Playwright (sous-ensemble)                     | home, health, devis minimal, login admin après déploiement                        |
| Sécurité    | CI                                             | RBAC, validation, gitleaks, audit, headers                                        |

Pas de mock Prisma pour tester des invariants DB.

## Conséquences

La CI démarre un PostgreSQL. Les E2E tournent sur les PR ciblées et en staging.
