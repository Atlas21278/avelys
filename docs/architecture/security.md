# Sécurité applicative et RGPD

Source : Master Spec §18, §26, §27, §33.4, §42. ADR-0005.

## Authentification et autorisation

- Better Auth, sessions en base, cookies `HttpOnly`, `Secure`, `SameSite=Lax`.
- Admin/Dispatcher/Driver : email + mot de passe (hash géré par Better Auth) ; **2FA TOTP obligatoire pour `ADMIN` et `DISPATCHER`** (DEC-15, tranchée le 2026-09-28).
- Clients : magic link email ; compte facultatif.
- RBAC : `ADMIN`, `DISPATCHER`, `DRIVER`, `CUSTOMER`, contrôlé côté serveur à chaque action.
- Accès guest à une réservation : lien signé à usage limité envoyé par email (pas de devinette par référence publique seule).

### Back-office (VTC-016)

| Élément           | Mise en œuvre                                                                                                                                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration     | `src/server/auth/auth.ts` : Better Auth, adaptateur Prisma, endpoints sous `/api/auth/*`, cookies préfixés `avelys`, secret `BETTER_AUTH_SECRET` (≥ 32 caractères, validé par Zod).                                                                                                 |
| Sessions          | Table `Session` en PostgreSQL, sans cache cookie : une déconnexion ou une session supprimée est effective à la requête suivante.                                                                                                                                                    |
| Comptes           | Aucune inscription publique (`disableSignUp`). Création par script local : `pnpm auth:create-staff --email … --name … [--role ADMIN\|DISPATCHER\|DRIVER]` ; mot de passe saisi masqué (ou lu sur stdin), 12 caractères minimum, jamais en argument.                                 |
| Rôles             | Colonne `User.role` (enum `UserRole`), jamais modifiable par une requête (`input: false`). Règles pures dans `src/domain/auth/access.ts`.                                                                                                                                           |
| 2FA               | TOTP obligatoire pour `ADMIN` et `DISPATCHER` (ADR-0005, DEC-15). Enrôlement à la première connexion (`/admin/two-factor/setup`) : clé à saisir dans l'application + codes de secours à usage unique. Désactivation et « appareil de confiance » refusés.                           |
| Contrôle d'accès  | `checkAccess()` (`src/server/auth/access.ts`) charge la session en base puis applique le rôle, puis la 2FA. Chaque page back-office appelle `requireBackOfficeUser()` ; chaque future action serveur ou route handler appelle `checkAccess()`. Pas de contrôle dans un layout seul. |
| Réponses du garde | Sans session → `/admin/login` ; rôle non autorisé → 404 ; 2FA non enrôlée → `/admin/two-factor/setup`.                                                                                                                                                                              |
| Rate limiting     | Limiteur Better Auth stocké en base (table `RateLimit`, cohérent entre réplicas), par IP (`x-forwarded-for`) et par chemin : connexion 3 requêtes / 10 s, endpoints 2FA 3 / 10 s, défaut 100 / 10 s. L'ingress doit transmettre l'IP client.                                        |
| Limites connues   | L'enrôlement 2FA se fait avec le seul mot de passe à la première connexion : créer le compte juste avant la première connexion de son titulaire. Pas de QR code (clé à saisir ou lien `otpauth://`).                                                                                |

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
