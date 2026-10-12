# Tests de bout en bout (Playwright, VTC-048)

Parcours critique automatisé (ADR-0012) : devis → demande de réservation → acceptation admin → paiement test, plus la régularisation SCA et la double soumission. Outil : `@playwright/test` (Chromium), choisi par ADR-0012 : aucune nouvelle ADR n'est nécessaire.

## Scénarios (`e2e/booking-payment.spec.ts`)

| Scénario | Carte de test                                      | Attendu                                                                                                                                                                                                                                                |
| -------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1        | `4242 4242 4242 4242` (succès)                     | devis → coordonnées → carte → demande `REQUESTED` (référence affichée, paiement « En attente ») → connexion admin (2FA) → acceptation → Payment « Payé », réservation « Confirmée », montant identique au devis                                        |
| 1 bis    | `4000 0025 0000 3155` (SCA à l'enregistrement)     | fenêtre 3-D Secure « Complete » à l'enregistrement, puis débit hors session réussi → « Payé », « Confirmée »                                                                                                                                           |
| 2 (SCA)  | `4000 0027 6000 3184` (SCA à chaque transaction)   | acceptation → « Authentification client requise », réservation « Acceptée » → lien copié depuis le détail (VTC-042) → page client « Authentifier le paiement » → « Complete » → webhook → « Payé », « Confirmée » ; le lien n'est ensuite plus valable |
| 3        | `4242 4242 4242 4242`, **double clic** sur l'envoi | une seule requête `POST /api/v1/bookings` et une seule réservation en base pour cet email                                                                                                                                                              |

Numéros repris de la page « Testing » de Stripe (`docs.stripe.com/testing`, section authentification). La relance manuelle (VTC-041) reste couverte en intégration, hors E2E.

La connexion admin (`e2e/admin.setup.ts`) passe par l'écran de connexion puis le code TOTP à 6 chiffres, calculé par le test à partir du secret enrôlé au démarrage du run sur la base E2E (`e2e/support/seed-admin.ts`). Ce secret n'existe que dans la mémoire du run ; l'état de session est gardé dans `e2e/.auth/` (ignoré par git, jamais publié en artefact).

## Deux modes Stripe

| Mode                       | Commande               | Clés                                               | Quand                                                            |
| -------------------------- | ---------------------- | -------------------------------------------------- | ---------------------------------------------------------------- |
| **Stripe simulé** (défaut) | `pnpm test:e2e`        | aucune                                             | toujours : local et CI, sur chaque PR concernée                  |
| **Stripe test mode**       | `pnpm test:e2e:stripe` | clés **de test** + `stripe listen` (voir plus bas) | opt-in : seulement si les clés sont présentes, sinon « skipped » |

**Stripe simulé.** Le serveur parle à une fausse API Stripe locale (`e2e/stubs/fake-stripe-server.ts`, lancée par Playwright sur `127.0.0.1:12111`) qui reproduit les objets et le comportement documenté des cartes de test : Customers, SetupIntents, PaymentIntents hors session, clés d'idempotence, erreurs `authentication_required`, et webhooks `payment_intent.*` **signés** comme Stripe (même vérification de signature, même déduplication par `event.id` que la production). Dans le navigateur, `https://js.stripe.com/*` est remplacé par un faux Stripe.js (`e2e/stubs/fake-stripe.js`) : un champ « Card number » à la place du Payment Element, et une fenêtre 3-D Secure simulée « Complete » / « Fail ». Tout autre appel à un domaine Stripe est bloqué et fait échouer le test.

**Stripe test mode.** Mêmes scénarios, avec le vrai Stripe.js (iframes du Payment Element, page d'authentification de test Stripe) et l'API Stripe en test mode ; les webhooks arrivent par `stripe listen`. Sans les clés, le projet est rapporté « skipped » : ce n'est pas un test affaibli, les mêmes scénarios tournent toujours en mode simulé ; le mode test mode ajoute seulement la vérification contre le vrai Stripe.

## Google Maps : jamais appelé

- Serveur : `E2E_FAKE_ROUTING=true` remplace le routage Google par une table fixe de lieux de test (`src/integrations/maps/fake-routing.ts`, `fake-places.ts`) ; une distance est une entrée de table, jamais un calcul à vol d'oiseau ; un lieu inconnu n'a pas de prix.
- Navigateur : le script Maps JavaScript API est remplacé par `e2e/stubs/fake-places.js` (autocomplétion sur les mêmes lieux de test). Toute autre requête vers un domaine Google Maps est bloquée et fait échouer le test.

## Interrupteurs de test (refusés hors local / CI)

| Variable             | Effet                                                                  | Garde                                                                                         |
| -------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `E2E_FAKE_ROUTING`   | routage serveur par la table de test                                   | refusée par le schéma d'environnement si `APP_ENV` vaut `staging` ou `production`             |
| `E2E_STRIPE_API_URL` | le client Stripe serveur vise la fausse API au lieu d'`api.stripe.com` | idem, et URL HTTP(S) **loopback** uniquement ; les clés restent soumises à la garde test mode |

Une valeur posée par erreur en staging ou production fait échouer la validation de l'environnement (nom de la variable seulement, jamais sa valeur) : l'application ne démarre pas sur un faux. Tests unitaires : `src/lib/env/schema.test.ts`. Aucun chemin de production ne change de comportement : sans ces variables, routage et client Stripe sont ceux de production.

## Lancer en local

Prérequis : Docker (`pnpm db:up`, PostgreSQL du `docker-compose.yml` sur le port 5433) et Chromium pour Playwright (une fois).

```bash
pnpm db:up
pnpm exec playwright install chromium   # une fois
pnpm build                              # le run démarre le build de production (standalone)
pnpm test:e2e
```

- Base dédiée **`avelys_e2e`** (créée si absente, migrations appliquées, règle tarifaire provisoire de dev publiée par `pnpm db:seed`, compte admin recréé à chaque run). Le run refuse toute base dont le nom ne finit pas par `_e2e` ou `_test`. URL modifiable par `E2E_DATABASE_URL`.
- L'application tourne sur `http://localhost:3100` (`E2E_APP_PORT`), avec un environnement entièrement fixé par `e2e/support/env.ts` : le `.env` local n'est pas utilisé, aucune vraie clé n'est lue. Les valeurs de cet environnement sont des marqueurs de test, pas des secrets.
- Aucun email n'est envoyé (pas de clé Resend : envoi tracé `FAILED`, réservation inchangée, BR-50).
- Rapport : `playwright-report/fake/` ; traces et captures en cas d'échec : `test-results/`.

### Mode Stripe test mode en local

Avec un compte Stripe en **test mode** et la Stripe CLI :

```bash
export STRIPE_SECRET_KEY_TEST=sk_test_…            # clé de test, jamais commitée
export NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST=pk_test_…
export STRIPE_WEBHOOK_SECRET_TEST="$(stripe listen --api-key "$STRIPE_SECRET_KEY_TEST" --print-secret)"
stripe listen --api-key "$STRIPE_SECRET_KEY_TEST" --forward-to http://localhost:3100/api/webhooks/stripe &
pnpm build && pnpm test:e2e:stripe
```

Une clé live est refusée par le schéma d'environnement, par l'adaptateur et par le job CI (BR-44).

## CI (`.github/workflows/e2e.yml`)

- Déclenchement : PR touchant `src/**`, `prisma/**`, `e2e/**`, la config Playwright, `next.config.ts`, `package.json`, `pnpm-lock.yaml` ou le workflow ; push sur `main` ; manuel.
- Job **`e2e`** : PostgreSQL 17 en service (base `avelys_e2e`), `pnpm build`, `pnpm test:e2e`. Aucun secret. En cas d'échec : rapport HTML, traces et captures en artefact (7 jours) ; rapport JUnit toujours (14 jours). Données de test uniquement (adresses `example.com`, cartes de test, base jetable) ; l'état de session admin n'est pas publié.
- Job **`e2e-stripe-test-mode`** : ne fait rien d'autre qu'une notice tant que les secrets manquent. Avec les secrets : vérification du préfixe test mode, Stripe CLI épinglée (somme de contrôle vérifiée), `stripe listen` (secret de signature de session masqué), `pnpm test:e2e:stripe`. Les secrets ne sont exposés qu'aux étapes qui en ont besoin, jamais à `pnpm install`. Pas de trace Playwright dans ce mode (captures seulement).
- Passer ces jobs en check requis relève du ruleset (propriétaire).

### Action propriétaire : secrets du mode Stripe test mode

Dans _Settings → Secrets and variables → Actions_ du dépôt, ajouter (clés **test mode** du Dashboard Stripe, jamais live) :

| Secret                                    | Valeur                                              |
| ----------------------------------------- | --------------------------------------------------- |
| `STRIPE_SECRET_KEY_TEST`                  | clé secrète `sk_test_…` (ou restreinte `rk_test_…`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST` | clé publiable `pk_test_…`                           |

Le secret de signature des webhooks n'est pas à ajouter : `stripe listen` le crée pour chaque run.

## Dépannage

- « no production build found » : lancer `pnpm build`.
- Port 3100 ou 12111 occupé : `E2E_APP_PORT` / `E2E_FAKE_STRIPE_PORT`.
- Logs de l'application pendant le run : `E2E_LOG_LEVEL=info pnpm test:e2e` (logs sans PII, `bookingRef` seulement).
