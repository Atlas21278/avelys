# Sécurité applicative et RGPD

Source : Master Spec §18, §26, §27, §33.4, §42. ADR-0005.

## Authentification et autorisation

- Better Auth, sessions en base, cookies `HttpOnly`, `Secure`, `SameSite=Lax`.
- Admin/Dispatcher/Driver : email + mot de passe (hash géré par Better Auth) ; **2FA obligatoire pour les rôles admin** (TOTP).
- Clients : magic link email ; compte facultatif.
- RBAC : `ADMIN`, `DISPATCHER`, `DRIVER`, `CUSTOMER`, contrôlé côté serveur à chaque action.
- Accès guest à une réservation : lien signé à usage limité envoyé par email (pas de devinette par référence publique seule).

## Protection

| Menace  | Mesure                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------ |
| XSS     | Échappement React, CSP stricte (nonces), pas de `dangerouslySetInnerHTML` non assaini                  |
| CSRF    | Server actions Next.js (vérif. Origin) + SameSite ; webhooks exclus mais signés                        |
| SQLi    | Prisma paramétré ; `$queryRaw` uniquement en template taggé                                            |
| SSRF    | Aucune URL fournie par l'utilisateur n'est appelée côté serveur ; intégrations sur hôtes fixes         |
| Abus    | Rate limiting sur auth, devis et endpoints coûteux (Maps) ; anti-spam (honeypot + limite)              |
| Headers | HSTS, CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'` |

## Secrets

| Env        | Principe                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------ |
| Local      | `.env` non commité ; `.env.example` sans valeurs ; variables validées par Zod au démarrage |
| CI         | GitHub Secrets minimaux, job-scoped ; OIDC vers le cloud si supporté                       |
| Staging    | Clés test/ressources séparées                                                              |
| Production | Secret manager, accès court et audité ; jamais en clair dans Git/Helm values               |

gitleaks en CI et en pre-commit recommandé. Claude ne lit ni n'affiche jamais une valeur de secret.

## RGPD

- Minimisation : ne collecter que le nécessaire au transport et à la facturation.
- Logs : `bookingRef`, jamais nom/email/téléphone complets ; aucune donnée carte.
- Procédure d'accès et de suppression (anonymisation des Booking, conservation des factures selon obligations légales — DEC-04/DEC-11).
- Rétention : **DEC-11**.
- Consentement cookies avant tout tag non essentiel.
- Hébergement UE recommandé (ADR-0014).

## Garde-fous agents IA

Voir `CLAUDE.md` (Actions interdites) et `docs/process/agents.md`.
