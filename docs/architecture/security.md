# Sécurité applicative et RGPD

Source : Master Spec §18, §26, §27, §33.4, §42. ADR-0005.

## Authentification et autorisation

- Better Auth, sessions en base, cookies `HttpOnly`, `Secure`, `SameSite=Lax`.
- Admin/Dispatcher/Driver : email + mot de passe (hash géré par Better Auth) ; **2FA TOTP obligatoire pour `ADMIN` et `DISPATCHER`** (DEC-15, tranchée le 2026-09-28).
- Clients : magic link email ; compte facultatif.
- RBAC : `ADMIN`, `DISPATCHER`, `DRIVER`, `CUSTOMER`, contrôlé côté serveur à chaque action.
- Accès guest à une réservation : lien signé à usage limité envoyé par email (pas de devinette par référence publique seule).
- Lien de régularisation SCA (VTC-042) : jeton HMAC-SHA256 (`PAYMENT_LINK_SECRET`) sur `paymentId` + `attempt`, sans stockage ; utilisable seulement tant que le Payment courant attend le client (`REQUIRES_ACTION`, même tentative, réservation `ACCEPTED`, prise en charge future) ; tout refus → même 404 générique ; page `noindex`, `no-store`, `no-referrer`, affichage limité à référence, date et montant. Envoyé au seul `Customer.email` de la réservation (VTC-044), une fois par tentative ; le lien et son jeton ne sont jamais journalisés ni stockés (`Notification` ne garde ni adresse ni contenu) ; le dashboard Resend affiche le contenu des emails envoyés, donc le lien : l'accès au compte Resend est à réserver aux associés. Détail : `docs/product/payments.md` (« Régularisation SCA », « Email au client »).

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

| Menace                    | Mesure                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| XSS                       | Échappement React, CSP stricte (nonces), pas de `dangerouslySetInnerHTML` non assaini                                                                                                                                                      |
| CSRF                      | Server actions Next.js (vérif. Origin) + SameSite ; webhooks exclus mais signés                                                                                                                                                            |
| SQLi                      | Prisma paramétré ; `$queryRaw` uniquement en template taggé                                                                                                                                                                                |
| SSRF                      | Aucune URL fournie par l'utilisateur n'est appelée côté serveur ; intégrations sur hôtes fixes                                                                                                                                             |
| Abus                      | Rate limiting sur auth, devis et endpoints coûteux (Maps) ; anti-spam (honeypot + limite)                                                                                                                                                  |
| Exposition publique       | Routes de réservation anonymes (`bookings`, `payment-setups`) derrière `PUBLIC_BOOKING_ENABLED` (défaut `false`, 404) jusqu'à INFRA-005/INFRA-006 (VTC-045) ; le formulaire de devis de `/reservation` suit le même interrupteur (VTC-046) |
| Rejeu / double soumission | Demande idempotente par SetupIntent + email ; SetupIntent lié à l'email de la demande ; `submissionId` navigateur pour les clés d'idempotence Stripe (VTC-045)                                                                             |
| Audit falsifié            | `correlationId` tiré par le serveur sur les routes publiques anonymes (`x-request-id` client ignoré, VTC-045)                                                                                                                              |
| Headers                   | HSTS, CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`                                                                                                                                     |

## Secrets

| Env        | Principe                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------ |
| Local      | `.env` non commité ; `.env.example` sans valeurs ; variables validées par Zod au démarrage |
| CI         | GitHub Secrets minimaux, job-scoped ; OIDC vers le cloud si supporté                       |
| Staging    | Clés test/ressources séparées                                                              |
| Production | Secret manager, accès court et audité ; jamais en clair dans Git/Helm values               |

Clé Google Maps serveur (`GOOGLE_MAPS_SERVER_API_KEY`, VTC-024) : distincte de la clé navigateur, restreinte à la Routes API et aux IP de sortie, lue uniquement par `src/integrations/maps` au premier appel (jamais au build), envoyée en en-tête `X-Goog-Api-Key` (jamais en query string), masquée par le logger. Les logs de routing ne contiennent ni adresse, ni coordonnée, ni `placeId` (BR-60).

Clé Google Maps navigateur (`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY`, VTC-046, ADR-0010) : clé **distincte** de la clé serveur, publique par nature (elle est envoyée au navigateur), donc protégée par ses restrictions chez Google : référents HTTP du site uniquement, **Places API (New)** uniquement, quotas et alertes de budget au niveau gratuit (DEC-17). Création et restriction : action du propriétaire, valeur dans son `.env` local ou le secret manager, jamais dans le dépôt ni un ticket. Elle est lue par le serveur **à chaque requête** de la page de réservation (schéma d'environnement, `publicQuoteSettings()` de `src/server/public-booking.ts`) et transmise à la page ; elle n'est jamais inlinée au build (pas de référence littérale `process.env.NEXT_PUBLIC_…`), afin que la même image serve tous les environnements (ADR-0013), et le serveur ne l'utilise jamais pour appeler Google (le routing garde la clé serveur). Masquée par le logger. Absente, ou refusée par Google (`gm_authFailure`) : la page affiche « devis en ligne indisponible » et un lien de contact, jamais un prix. La clé serveur n'est jamais transmise au navigateur (testé).

Stripe (VTC-030, BR-44) : **test mode uniquement** dans tous les environnements. `STRIPE_SECRET_KEY` (`sk_test_`/`rk_test_`) et `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_`) sont refusées si live ou de format inconnu, par le schéma d'environnement et par l'adaptateur `src/integrations/stripe` (lu au premier usage, jamais au build) ; `STRIPE_WEBHOOK_SECRET` (`whsec_…`) signe l'endpoint webhook. Valeurs et en-tête `stripe-signature` masqués par le logger ; les erreurs ne reprennent jamais une valeur. Tests : secrets jetables générés à l'exécution, aucun littéral de clé dans le dépôt. Clé publiable (VTC-047) : lue par le serveur **à chaque requête** de la page de réservation (`publicQuoteSettings()`) et transmise à la page, comme la clé Maps navigateur : jamais inlinée au build ; la clé secrète n'est jamais transmise au navigateur (testé). Le formulaire public ne voit jamais de donnée de carte : le Payment Element est une iframe Stripe, seul l'id du SetupIntent (`seti_…`) est envoyé à `POST /api/v1/bookings` (BR-40) ; le `client_secret` reste en mémoire dans la page, jamais stocké ni journalisé.

Lien de régularisation SCA (`PAYMENT_LINK_SECRET`, VTC-042) : clé HMAC des liens de paiement envoyés aux clients, ≥ 32 caractères (validée par Zod), **distincte** de `BETTER_AUTH_SECRET` (égalité refusée par le schéma d'environnement, variable citée par son nom seul), masquée par le logger, jamais transmise au navigateur. Facultative : absente, aucun lien n'est généré et toute page de lien répond « invalide » (erreur de configuration journalisée par nom, une seule fois par processus ; les liens refusés sont journalisés au niveau `debug`, sans le jeton). Génération locale : `openssl rand -base64 32`. **Rotation** : changer la valeur invalide tous les liens en circulation ; recopier les liens utiles depuis le back-office (procédure : `docs/product/payments.md`). Le jeton est dans l'URL : la page n'est ni mise en cache (`no-store`), ni indexée (`noindex`), ni source de référent (`no-referrer`) ; le logger masque `token`, `clientSecret`/`client_secret` et `regularizationUrl`, et aucun log applicatif ne cite le jeton. Les journaux d'accès de l'ingress (INFRA-005) devront masquer ou tronquer les chemins `/paiement/*` et `/en/payment/*`. Le `client_secret` du PaymentIntent n'est lu que pour cette page, transmis au seul Stripe.js, jamais stocké ni journalisé.

Ce que reçoit **toute personne qui détient le lien** (VTC-042) : au-delà de la référence, de la date et du montant affichés, la page transmet au navigateur le `client_secret` du PaymentIntent et l'id `pm_…` de la carte enregistrée. Avec la clé publiable, le `client_secret` permet de **relire le PaymentIntent** (montant, statut, moyen de paiement, `last_payment_error`, qui peut porter l'objet moyen de paiement : marque, 4 derniers chiffres, expiration, pays ; contenu exact à confirmer lors de la vérification manuelle, `stripe.retrievePaymentIntent(clientSecret)`) et de **le confirmer avec une autre carte** par l'API (`payment_method_data`), ce que la page ne propose pas ; `Payment.stripePaymentMethodId` peut alors différer de la carte réellement débitée. C'est inhérent à toute confirmation SCA côté client d'un PaymentIntent existant, retenue par DEC-27 : le navigateur du client doit détenir le `client_secret`. Le montant reste celui fixé côté serveur (une clé publiable ne peut pas le modifier) et le PaymentIntent ne peut réussir qu'une fois. Mesures : lien utilisable seulement tant que le Payment courant attend le client (`REQUIRES_ACTION`, même tentative, réservation `ACCEPTED`, prise en charge future), invalidé par une relance (VTC-041, qui annule aussi le PaymentIntent ouvert), aucune donnée personnelle affichée hors référence, date et montant, jeton et `client_secret` jamais journalisés ni stockés, page `no-store`, `noindex`, `no-referrer`.

Sentry (à venir) devra filtrer les URL `/paiement/*` et `/en/payment/*` (breadcrumbs, transactions, en-têtes de requête), comme les journaux d'accès de l'ingress. Stripe.js lit aussi l'URL de la page (télémétrie, fraude) : risque jugé faible, Stripe détenant déjà le `client_secret`.

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
