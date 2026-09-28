# Runbooks

Source : Master Spec §36, §40, §41. Ces runbooks sont des squelettes ; ils seront complétés et **testés** en EPIC-16, une fois l'hébergeur choisi (DEC-12).

## RB-01 — Rollback applicatif

1. Identifier le dernier digest sain (historique du repo GitOps / release notes).
2. PR dans `avelys-gitops` remplaçant le digest de l'environnement par le digest sain.
3. Merge (approbation requise en prod) → Argo CD synchronise.
4. Vérifier health, Sentry, smoke tests.
5. ⚠ Un rollback de code ne rollbacke pas la base : vérifier que la migration courante est compatible avec l'ancienne version (expand/contract).

Interdit : `kubectl set image` / édition manuelle dans le cluster.

## RB-02 — Restauration PostgreSQL

À compléter selon le fournisseur : restauration PITR vers une nouvelle instance, bascule de la chaîne de connexion via secret, vérification, communication. RPO/RTO : DEC-14. Test de restauration périodique (fréquence DEC-14).

## RB-03 — Incident paiement

- Webhooks en échec : vérifier l'endpoint et le secret de signature (sans l'afficher), rejouer les événements depuis le Dashboard Stripe ; l'idempotence garantit l'absence de double effet.
- Paiement `REQUIRES_ACTION`/`FAILED` : vérifier l'email client, contacter le client, annuler si délai dépassé (DEC-13).

## RB-04 — Email indisponible

Les réservations restent valides (BR-50). Vérifier le statut Resend, puis relancer les `Notification` en échec via l'action admin.

## RB-05 — Routing (Maps) indisponible

Aucun prix n'est inventé (BR-51). Le site affiche une invitation à contacter l'équipe. Vérifier quotas/clé/restrictions.

Adaptateur `src/integrations/maps` (VTC-024) : les logs `routing attempt failed` / `routing unavailable` portent `code`, `reason`, `httpStatus`, `attempt`, `latencyMs` (jamais de lieu ni de clé).

| `code` / `reason`                                 | Cause probable                                             | Action                                                     |
| ------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| `ROUTING_PROVIDER_ERROR` / `not_configured`       | `GOOGLE_MAPS_SERVER_API_KEY` absente                       | Injecter la clé serveur (secret manager)                   |
| `ROUTING_PROVIDER_ERROR` / `forbidden`            | Clé refusée : restriction API/IP, API non activée, billing | Vérifier la clé et ses restrictions dans la console Google |
| `ROUTING_QUOTA_EXCEEDED` / `quota_exceeded`       | 429 ou `RESOURCE_EXHAUSTED`                                | Vérifier quotas et budget (DEC-17) ; pas de retry          |
| `ROUTING_PROVIDER_ERROR` / `http_5xx`, `network`  | Incident Google ou réseau (déjà retenté une fois)          | Statut Google Maps Platform                                |
| `ROUTING_PROVIDER_ERROR` / `timeout`              | Réponse > 5 s (non retentée)                               | Latence réseau sortante                                    |
| `ROUTE_UNAVAILABLE` / `no_route`, `zero_distance` | Aucun itinéraire routier                                   | Normal : pas de prix, contact équipe                       |

## RB-06 — Rotation de secret

À compléter avec le secret manager retenu. Toute rotation production = `CRITICAL`, approbation humaine.
