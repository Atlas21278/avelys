# Sécurité applicative et RGPD

Source : Master Spec §18, §26, §27, §33.4, §42. ADR-0005.

## Authentification et autorisation

- Better Auth, sessions en base, cookies `HttpOnly`, `Secure`, `SameSite=Lax`.
- Admin/Dispatcher/Driver : email + mot de passe (hash géré par Better Auth) ; **2FA TOTP obligatoire pour `ADMIN` et `DISPATCHER`** (DEC-15, tranchée le 2026-09-28).
- Clients : magic link email ; compte facultatif.
- RBAC : `ADMIN`, `DISPATCHER`, `DRIVER`, `CUSTOMER`, contrôlé côté serveur à chaque action.
- Accès guest à une réservation : lien signé à usage limité envoyé par email (pas de devinette par référence publique seule).

### Back-office (VTC-016)

| Élément           | Mise en œuvre                                                                                                                                                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration     | `src/server/auth/auth.ts` : Better Auth, adaptateur Prisma, endpoints sous `/api/auth/*`, cookies préfixés `avelys`, secret `BETTER_AUTH_SECRET` (≥ 32 caractères, validé par Zod).                                                                                                                 |
| Sessions          | Table `Session` en PostgreSQL, sans cache cookie : une déconnexion ou une session supprimée est effective à la requête suivante. Durée `AUTH_SESSION_MAX_AGE_SECONDS`, **valeur provisoire** : 7 jours par défaut (valeur Better Auth), glissante, à trancher.                                      |
| Comptes           | Aucune inscription publique (`disableSignUp`). Création par script local : `pnpm auth:create-staff --email … --name … [--role ADMIN\|DISPATCHER\|DRIVER]` ; mot de passe saisi masqué (ou lu sur stdin), 12 caractères minimum, jamais en argument.                                                 |
| Rôles             | Colonne `User.role` (enum `UserRole`), jamais modifiable par une requête (`input: false`). Règles pures dans `src/domain/auth/access.ts`.                                                                                                                                                           |
| 2FA               | TOTP obligatoire pour `ADMIN` et `DISPATCHER` (ADR-0005, DEC-15). Enrôlement à la première connexion (`/admin/two-factor/setup`) : clé à saisir dans l'application + codes de secours à usage unique. Désactivation et « appareil de confiance » refusés.                                           |
| Contrôle d'accès  | `checkAccess()` (`src/server/auth/access.ts`) charge la session en base puis applique le rôle, puis la 2FA. Chaque page back-office appelle `requireBackOfficeUser()` ; chaque future action serveur ou route handler appelle `checkAccess()`. Pas de contrôle dans un layout seul.                 |
| Réponses du garde | Sans session → `/admin/login` ; rôle non autorisé → 404 ; 2FA non enrôlée → `/admin/two-factor/setup`.                                                                                                                                                                                              |
| Rate limiting     | Limiteur Better Auth stocké en base (table `RateLimit`, cohérent entre réplicas), par IP client et par chemin : connexion 3 requêtes / 10 s, endpoints 2FA 3 / 10 s, défaut 100 / 10 s. Verrouillage TOTP du compte après 10 codes faux consécutifs (15 min). Résolution de l'IP : voir ci-dessous. |
| Limites connues   | L'enrôlement 2FA se fait avec le seul mot de passe à la première connexion : créer le compte juste avant la première connexion de son titulaire. Pas de QR code (clé à saisir ou lien `otpauth://`). Aucun verrouillage par compte sur le mot de passe : seule la limite par IP s'applique.         |

#### IP client et proxys de confiance (`TRUSTED_PROXIES`)

L'IP client est lue dans `X-Forwarded-For`. Ce header est fourni par le client et donc falsifiable : seules les entrées ajoutées par nos propres proxys font foi.

- `TRUSTED_PROXIES` : liste d'IP ou de plages CIDR (séparées par des virgules, validées par Zod) correspondant aux proxys de l'ingress. Le header est lu **de droite à gauche** en sautant ces proxys : la première adresse hors liste est le client. Les entrées plus à gauche, que le client peut inventer, sont ignorées (test d'intégration : `X-Forwarded-For: <usurpée>, <client>, <ingress>` est bien compté sur `<client>`).
- `TRUSTED_PROXIES` vide (défaut) : Better Auth n'accepte qu'un header **à valeur unique**. Si le header est absent ou contient plusieurs valeurs, aucune IP n'est retenue et toutes ces requêtes partagent un compteur `no-trusted-ip` par chemin. Conséquence : n'importe qui peut bloquer la connexion de tous (4 requêtes / 10 s). À l'inverse, un pod joignable sans proxy qui réécrit le header laisse un attaquant changer d'IP à chaque requête. Un avertissement est journalisé à l'initialisation de l'auth si `APP_ENV=production` et que la liste est vide.
- **Contrainte de déploiement** : la topologie de l'ingress (proxy qui écrase ou qui ajoute le header, load balancer cloud en amont, CIDR des pods ingress, pods applicatifs joignables uniquement via l'ingress par NetworkPolicy) n'est pas encore fixée. Elle le sera par **INFRA-005** (Atlas21278/avelys-private#67), qui renseignera `TRUSTED_PROXIES`. D'ici là, la protection par IP n'est garantie qu'en local et en test.

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

Clé Google Maps serveur (`GOOGLE_MAPS_SERVER_API_KEY`, VTC-024) : distincte de la clé navigateur, restreinte à la Routes API et aux IP de sortie, lue uniquement par `src/integrations/maps` au premier appel (jamais au build), envoyée en en-tête `X-Goog-Api-Key` (jamais en query string), masquée par le logger. Les logs de routing ne contiennent ni adresse, ni coordonnée, ni `placeId` (BR-60).

Stripe (VTC-030, BR-44) : **test mode uniquement** dans tous les environnements. `STRIPE_SECRET_KEY` (`sk_test_`/`rk_test_`) et `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_`) sont refusées si live ou de format inconnu, par le schéma d'environnement et par l'adaptateur `src/integrations/stripe` (lu au premier usage, jamais au build) ; `STRIPE_WEBHOOK_SECRET` (`whsec_…`) signe l'endpoint webhook. Valeurs et en-tête `stripe-signature` masqués par le logger ; les erreurs ne reprennent jamais une valeur. Tests : secrets jetables générés à l'exécution, aucun littéral de clé dans le dépôt.

Resend (VTC-043) : `RESEND_API_KEY` lue uniquement par `src/integrations/email` au premier envoi (jamais au build), masquée par le logger ; absente → `EMAIL_NOT_CONFIGURED`, sans effet sur la réservation. Les messages d'erreur du fournisseur (qui peuvent citer une adresse) ne sont ni journalisés ni stockés : seul un code technique l'est. Aucune adresse ni contenu d'email sur `Notification` (`docs/architecture/email.md`).

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
