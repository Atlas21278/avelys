# Disponibilité, dispatch et planning

Source : Master Spec §3, §9, §14, §54.5. Règles : BR-20 à BR-24, BR-32, BR-33. ADR-0007.

## Principe V1

Validation et affectation **humaines**, assistées par une compatibilité calculée. Pas de dispatch automatique, pas de GPS temps réel, pas d'API Uber/Bolt.

## Compatibilité chauffeur/véhicule pour une réservation

Pour chaque chauffeur candidat :

1. Statut déclaré compatible (`AVAILABLE` ; `PLATFORM` = peut être sur Uber/Bolt, compatible sous réserve de confirmation humaine).
2. Aucun créneau `DriverAvailability` d'indisponibilité chevauchant.
3. Course précédente : sa destination devient la position prévisionnelle ; temps de repositionnement estimé jusqu'au pickup + buffer (30 min provisoire) ≤ écart disponible.
4. Course suivante : fin estimée de la course + repositionnement + buffer ≤ début de la suivante.
5. Véhicule : statut stocké `AVAILABLE`, pas d'indisponibilité, capacité passagers/bagages suffisante, pas de chevauchement.

Résultat : `COMPATIBLE`, `TIGHT` (marge faible), `CONFLICT` avec raisons lisibles. Fonction pure dans `src/domain/dispatch/`.

> Le temps de repositionnement nécessite un appel routing ; en V1, une estimation (matrice Maps ou heuristique documentée) est acceptable si elle est explicite dans l'UI. Choix fixé dans le ticket EPIC-11 concerné.

## Anti double-affectation (défense en profondeur)

- Applicatif : vérification avant écriture pour renvoyer un message clair.
- Base : extension `btree_gist` + contraintes d'exclusion sur `(driverId, tstzrange(start, end + buffer))` et `(vehicleId, même plage)`, restreintes aux réservations non finales (`WHERE status NOT IN ('REFUSED','CANCELLED','NO_SHOW','COMPLETED')`).
- Ajoutées en SQL dans une migration Prisma (voir `docs/architecture/database.md`). La violation (`23P01`) est traduite en erreur métier `ASSIGNMENT_CONFLICT`.

> Point d'attention : la plage doit être matérialisée (colonnes `blockedFrom`/`blockedUntil` calculées à l'affectation, buffer inclus) car une contrainte d'exclusion ne peut pas lire une config externe.

## Dashboard interne

Vue jour par défaut (semaine/mois secondaires) · demandes `REQUESTED` en priorité · compatibilité · affectation manuelle · courses du jour et statuts · clients · paiements/remboursements · factures · PricingRules · PromoCodes · chauffeurs/véhicules/indisponibilités · audit des actions sensibles. **Utilisable sur smartphone.**

## Rôles

| Rôle         | Périmètre                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN`      | Tout, y compris tarifs, promos, utilisateurs, remboursements. 2FA obligatoire.                                                |
| `DISPATCHER` | Accepter/refuser, affecter, planning, indisponibilités. 2FA obligatoire (rôle admin au sens de la spec — à confirmer DEC-15). |
| `DRIVER`     | Ses courses, démarrer/terminer/no-show, ses indisponibilités.                                                                 |
| `CUSTOMER`   | Ses réservations, factures, profil.                                                                                           |
