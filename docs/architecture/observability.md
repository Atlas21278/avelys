# Observabilité

Source : Master Spec §38, §39, §40.

## Erreurs

Sentry (serveur + client), environnement et release (= SHA Git) renseignés, `sendDefaultPii: false`, scrubbing des champs sensibles. V1 : tri manuel des incidents ; Incident Agent en phase 2.

## Logs

- pino, JSON sur stdout.
- Champs standard : `level`, `time`, `msg`, `correlationId`, `bookingRef` (si pertinent), `route`, `durationMs`, `env`, `release`.
- `correlationId` généré à l'entrée (ou repris de `x-request-id`) et propagé via `AsyncLocalStorage`.
- Redaction pino configurée (`authorization`, `cookie`, `email`, `phone`, `*.token`, `*.secret`).
- Jamais : secrets, données carte, contenu personnel inutile.

## Métriques

- Application : taux et latence HTTP, erreurs 5xx, devis générés, réservations par statut, échecs de paiement, échecs d'email, erreurs Maps.
- Kubernetes : restarts, replicas indisponibles, CPU/mémoire, échecs de probes.
- Stack métriques/dashboards à décider avec l'hébergeur (DEC-12) : Prometheus/Grafana ou offre managée.

## Alertes (orientées action)

| Alerte                                             | Action attendue                                    |
| -------------------------------------------------- | -------------------------------------------------- |
| Health KO / pods en CrashLoop                      | Runbook rollback                                   |
| Pic d'erreurs 5xx                                  | Sentry → diagnostic                                |
| Échecs webhooks Stripe                             | Vérifier signature/endpoint, rejouer depuis Stripe |
| Paiements `FAILED` / `REQUIRES_ACTION` non résolus | Contacter le client                                |
| Échecs d'email répétés                             | Vérifier Resend, renvoyer                          |
| Backup en échec                                    | Runbook backups                                    |

## Dashboards

Santé application · réservations · paiements · emails · infrastructure.
