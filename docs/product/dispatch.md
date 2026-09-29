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

## Navigation vers les points de prise en charge et de dépose (VTC-039)

Le dispatch et le chauffeur naviguent **uniquement** vers les coordonnées de l'itinéraire tarifé (`pickupLat`/`pickupLng`, `dropoffLat`/`dropoffLng`, identiques à `resolvedPoints` du snapshot de prix) ou, à défaut, vers le `placeId` soumis. **Jamais vers le libellé saisi par le client** : il est affiché pour information, mais n'est ni géocodé ni transmis à une application de navigation, car il peut être ambigu, incomplet ou différent du point réellement tarifé. Voir `docs/product/booking.md` (coordonnées stockées = coordonnées tarifées).

## Anti double-affectation (défense en profondeur)

- Applicatif : vérification avant écriture pour renvoyer un message clair.
- Base : extension `btree_gist` + contraintes d'exclusion sur `(driverId, tstzrange(start, end + buffer))` et `(vehicleId, même plage)`, restreintes aux réservations non finales (`WHERE status NOT IN ('REFUSED','CANCELLED','NO_SHOW','COMPLETED')`).
- Ajoutées en SQL dans une migration Prisma (voir `docs/architecture/database.md`). La violation (`23P01`) est traduite en erreur métier `ASSIGNMENT_CONFLICT`.

> Point d'attention : la plage doit être matérialisée (colonnes `blockedFrom`/`blockedUntil` calculées à l'affectation, buffer inclus) car une contrainte d'exclusion ne peut pas lire une config externe.

## Dashboard interne

Vue jour par défaut (semaine/mois secondaires) · demandes `REQUESTED` en priorité · compatibilité · affectation manuelle · courses du jour et statuts · clients · paiements/remboursements · factures · PricingRules · PromoCodes · chauffeurs/véhicules/indisponibilités · audit des actions sensibles. **Utilisable sur smartphone.**

### Réservations en lecture seule (VTC-029)

Écrans livrés, en français comme le reste de `/admin`, réservés à `ADMIN` et `DISPATCHER` avec 2FA. Seule action d'écriture : accepter / refuser une demande `REQUESTED` depuis le détail (VTC-032, `booking.md` § Service de décision). Aucun statut de paiement (VTC-031).

| Élément      | Comportement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Liste        | `/admin/reservations` : référence, statut, prise en charge (heure de Paris), départ → arrivée, passagers/bagages, montant TTC, nom du contact (`resolveBookingContact`, VTC-038). `REQUESTED` d'abord (« Demandes à traiter »), puis les autres statuts ; chaque groupe par `pickupAt` croissant.                                                                                                                                                                                                                                     |
| Filtres      | Paramètres d'URL validés par Zod (`src/server/admin/booking-list-query.ts`) : `status` (répétable), `from` / `to` (jours calendaires de Paris, `YYYY-MM-DD`, bornes incluses, converties en instants UTC en tenant compte des jours de 23 h et 25 h), `page`. Une valeur invalide est ignorée (valeur par défaut), la page ne tombe jamais en erreur. Si `from` est postérieur à `to`, la page l'indique explicitement et propose d'inverser les dates.                                                                               |
| Pagination   | Serveur, `BOOKING_LIST_PAGE_SIZE` = 20 lignes, page bornée à `BOOKING_LIST_MAX_PAGE` = 500. Lecture en deux segments indexés (`REQUESTED`, puis le reste), découpe pure dans `src/domain/booking/back-office-order.ts`.                                                                                                                                                                                                                                                                                                               |
| Détail       | `/admin/reservations/[reference]` (saisie tolérante `normalizeReference` ; référence invalide ou inconnue → 404) : trajet et distance/durée du devis, passagers/bagages, vol/train, montants TTC/HT/TVA (HT et TVA « — » tant qu'ils sont `null`, DEC-04, jamais recalculés), version de la règle tarifaire, client (nom, téléphone, email, langue), note client et note interne séparées et étiquetées, horodatages, historique `AuditLog` chronologique (acteur, transition, heure de Paris et décalage UTC). Pas de snapshot brut. |
| Heures       | `src/lib/dates.ts` (date-fns + `@date-fns/tz`, fuseau `Europe/Paris`). Le décalage (`UTC+01:00` / `UTC+02:00`) est affiché sur le détail pour distinguer l'heure répétée de fin octobre ; dans la liste, il n'est ajouté que si l'heure de Paris est ambiguë (`formatParisDateTimeUnambiguous`). Le même module convertit aussi les heures murales saisies en UTC (`resolveLocalDateTime`, devis).                                                                                                                                    |
| Autorisation | Chaque page appelle `requireBackOfficeUser()` ; chaque fonction de `src/server/admin/bookings.ts` revérifie la session (`checkAccess`) et lève `BackOfficeAccessError` sinon. `select` explicite : ni snapshot, ni coordonnées ; la liste ne renvoie que le nom du contact. Aucune journalisation de données personnelles.                                                                                                                                                                                                            |

## Rôles

| Rôle         | Périmètre                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN`      | Tout, y compris tarifs, promos, utilisateurs, remboursements. 2FA obligatoire.                                                |
| `DISPATCHER` | Accepter/refuser, affecter, planning, indisponibilités. 2FA obligatoire (rôle admin au sens de la spec — à confirmer DEC-15). |
| `DRIVER`     | Ses courses, démarrer/terminer/no-show, ses indisponibilités.                                                                 |
| `CUSTOMER`   | Ses réservations, factures, profil.                                                                                           |
