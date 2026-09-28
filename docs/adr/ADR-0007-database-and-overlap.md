# ADR-0007 — PostgreSQL, Prisma et anti double-affectation

- **Statut** : Accepté
- **Date** : 2026-09-28
- **Source** : Master Spec §9, §20, §37, §54.5

## Décision

- PostgreSQL + Prisma. Local via Docker Compose.
- Double affectation empêchée à deux niveaux : vérification applicative (message clair) **et** contraintes d'exclusion `btree_gist` sur `(driverId, plage)` et `(vehicleId, plage)` pour les réservations non finales.
- Plage = `[blockedFrom, blockedUntil)` matérialisée à l'affectation, buffer inclus.
- SQL ajouté manuellement dans la migration Prisma et documenté dans `docs/architecture/database.md`.

## Conséquences

Les tests d'intégration exigent un vrai PostgreSQL. La détection de drift Prisma doit tenir compte de ces contraintes. Verrouille le choix PostgreSQL.
