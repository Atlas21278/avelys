# Règles métier transverses

Source : Master Spec §0.2, §3, §8.2, §9, §10, §11, §12, §15, §18, §19.1.
Chaque règle a un identifiant `BR-xx` à citer dans les tickets, tests et PR.

## Principes

| ID    | Règle                                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-01 | Aucune règle tarifaire, fiscale, juridique, de remboursement, de sécurité ou de production n'est inventée. Valeur absente → `DECISION-*` (voir `private/docs/decisions/register.md`). |
| BR-02 | Les valeurs provisoires sont configurables (base ou config), jamais dispersées dans le code, et identifiées comme provisoires.                                                        |
| BR-03 | Les changements de périmètre mettent à jour `docs/` avant ou dans la même PR que le code.                                                                                             |

## Argent

| ID    | Règle                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-10 | Montants en centimes (`Int`) + devise ISO 4217 (EUR initialement). Jamais de flottant.                                                          |
| BR-11 | HT, TVA et TTC sont modélisés séparément.                                                                                                       |
| BR-12 | Le navigateur n'est jamais la source de vérité du montant ; le serveur recalcule avant création/confirmation du paiement.                       |
| BR-13 | Chaque Booking conserve prix final + snapshot des règles et inputs. Une modification de `PricingRule` n'altère pas les réservations existantes. |
| BR-14 | Une facture n'est jamais recalculée avec une nouvelle route ou de nouvelles règles.                                                             |

## Ressources

| ID    | Règle                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| BR-20 | Le client achète une catégorie/service, pas un véhicule précis.                                                                            |
| BR-21 | Statut chauffeur déclaré (`AVAILABLE`, `UNAVAILABLE`, `PLATFORM`, `BREAK`, `LEAVE`) distinct des créneaux d'indisponibilité datés.         |
| BR-22 | Statut véhicule stocké : `AVAILABLE`, `MAINTENANCE`, `UNAVAILABLE`. `ON_TRIP` est calculé depuis les réservations en cours, jamais stocké. |
| BR-23 | Permissions applicatives séparées du statut opérationnel chauffeur.                                                                        |
| BR-24 | La finition exacte des véhicules n'est pas codée en dur.                                                                                   |

## Réservation et dispatch

| ID    | Règle                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| BR-30 | Transitions Booking centralisées, testées et auditées ; transition invalide = erreur explicite (`booking.md`).                        |
| BR-31 | Délai minimal de réservation : 12 h (provisoire, configurable). En dessous : proposer un contact direct, pas un simple écran d'échec. |
| BR-32 | Pas de double affectation chauffeur ou véhicule : contrôle applicatif + contrainte d'exclusion PostgreSQL (`dispatch.md`).            |
| BR-33 | Buffer entre courses : 30 min (provisoire, configurable).                                                                             |
| BR-34 | Aéroport/gare : distinguer heure prévue (vol/train), heure de pickup demandée et mises à jour opérationnelles.                        |

## Paiement

| ID    | Règle                                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------- |
| BR-40 | Ne jamais stocker PAN/CVC.                                                                                              |
| BR-41 | Statut Stripe (`Payment`) et statut métier (`Booking`) séparés ; le statut de paiement n'est pas dupliqué dans Booking. |
| BR-42 | Webhooks vérifiés cryptographiquement et idempotents.                                                                   |
| BR-43 | Remboursements journalisés.                                                                                             |
| BR-44 | Modifier clés, webhooks ou logique de capture en production = changement `CRITICAL`, approbation humaine.               |

## Communication et résilience

| ID    | Règle                                                          |
| ----- | -------------------------------------------------------------- |
| BR-50 | Un échec d'email ne corrompt pas l'état de réservation.        |
| BR-51 | Routing indisponible → pas de prix inventé ; erreur propre.    |
| BR-52 | Stockage UTC ; affichage Europe/Paris ou timezone du contexte. |

## Données personnelles

| ID    | Règle                                                              |
| ----- | ------------------------------------------------------------------ |
| BR-60 | Minimisation des données ; logs sans données bancaires ni secrets. |
| BR-61 | Procédure d'accès/suppression RGPD ; rétention = DEC-11.           |
