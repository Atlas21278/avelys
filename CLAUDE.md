# CLAUDE.md — avelys

> Marque : **Avelys** (DEC-01, décidé le 2026-09-28). Repo `avelys`, repo GitOps `avelys-gitops`. Domaine encore à valider (DEC-01b).
> Dépôt public. Spec, tarifs, registre des décisions et backlog : dépôt privé `avelys-private`, cloné en local dans `private/` (voir `README.md`). Ne jamais copier leur contenu dans ce dépôt.
> Source de vérité : `private/Master_Specification_VTC.md` (niveau 1) > ADR approuvés (`docs/adr/`) > `docs/` > tickets > code.
> Ce fichier résume ; il renvoie vers `docs/` au lieu de recopier la spec.

## Produit

Plateforme VTC premium propriétaire (Paris) pour deux associés chauffeurs et deux BYD Seal 2026 : devis, réservation, paiement Stripe, validation et dispatch manuels, exploitation, facturation. FR (défaut) / EN.
→ `docs/product/vision.md` · produit pour le design : `PRODUCT.md` · système visuel : `DESIGN.md` (planche `/design`, hors production)

## Stack (figée par ADR, révisable par ADR)

Node.js LTS (`.nvmrc` + `engines`) · pnpm via Corepack · Next.js App Router (`output: 'standalone'`) · TypeScript `strict` + `noUncheckedIndexedAccess` · Tailwind CSS · Zod · next-intl · Better Auth · Prisma + PostgreSQL · Stripe · Google Maps Platform · Resend + React Email · `@react-pdf/renderer` · date-fns + `@date-fns/tz` · pino · Sentry · Vitest · Playwright · Docker · Helm · Argo CD · GitHub Actions · GHCR.
→ `docs/architecture/overview.md`, `docs/adr/`

## Commandes

> Source de vérité : `package.json`. Une commande absente n'existe pas encore : ne pas l'inventer.

```bash
fnm use                          # Node LTS lue depuis .nvmrc (24)
corepack enable && pnpm install --frozen-lockfile   # lance aussi prisma generate
git config core.hooksPath .githooks   # refuse les push directs sur main
cp .env.example .env             # une fois ; valeurs locales uniquement
pnpm db:up                       # PostgreSQL 17 local (docker compose, port 5433, bases avelys + avelys_test)
pnpm db:migrate                  # prisma migrate dev — dev uniquement
pnpm dev
pnpm lint
pnpm typecheck                   # next typegen + tsc --noEmit
pnpm test                        # Vitest, projet unit
pnpm test:int                    # Vitest, projet integration (base avelys_test, migrations appliquées)
pnpm build                       # sans variables d'environnement : validées au premier usage
```

Santé : `GET /api/health` (vivacité, sans dépendance) et `GET /api/health/ready` (PostgreSQL, 503 si indisponible).
Logs : `logger()` de `src/lib/logger.ts` (pino JSON, `correlationId` automatique dans une requête, champs sensibles masqués).

## Structure

```
src/
  app/            routes et UI (App Router) — aucune logique métier ici
  domain/         règles métier pures, sans I/O (pricing, transitions, dispatch, promos)
  server/         services, accès données (Prisma), transactions, autorisation
  integrations/   Stripe, Google Maps, Resend — adaptateurs isolés, mockables
  lib/            utilitaires transverses (env, logger, errors, dates, money)
prisma/           schéma + migrations (SQL manuel autorisé pour btree_gist / exclusions)
charts/avelys/    chart Helm
.github/          workflows, templates, CODEOWNERS
docs/             documentation maintenue
```

Le repo GitOps (`avelys-gitops`) est séparé (ADR-0002).

## Conventions

- Conventional Commits avec ID ticket : `feat(booking): VTC-031 add transition guard`.
- Branches : `feature/VTC-xxx-slug`, `fix/BUG-xxx-slug`, `infra/INFRA-xxx-slug`. PR obligatoire, squash merge.
- Routes FR sans préfixe, EN sous `/en`.
- Code, identifiants et commentaires en anglais ; docs et contenus utilisateur FR/EN.
- Validation Zod de toute entrée externe (API, formulaires, env, webhooks).
- Erreurs API : `{ code, message, correlationId }` ; jamais de stack trace en production.

## Règles métier critiques — ne jamais violer

1. **Le montant n'est jamais accepté depuis le navigateur.** Le serveur recalcule avant création/confirmation du paiement. → `private/docs/product/pricing.md`
2. **Montants en centimes (`Int`)** + devise ISO 4217. Jamais de `float`. HT/TVA/TTC séparés.
3. **Chaque Booking conserve un snapshot** des règles et inputs de prix ; modifier une `PricingRule` n'altère jamais une réservation existante.
4. **Prix = distance routière**, jamais à vol d'oiseau. Routing indisponible → pas de prix inventé.
5. **Transitions d'état centralisées** dans `src/domain/`, testées, auditées (`AuditLog`). Transition invalide = erreur explicite. → `docs/product/booking.md`
6. **Statut Stripe et statut Booking séparés.** Webhooks signés et idempotents (event id persisté). → `docs/product/payments.md`
7. **Pas de double affectation** chauffeur/véhicule : contrôle applicatif **et** contrainte d'exclusion PostgreSQL. → `docs/product/dispatch.md`
8. **`ON_TRIP` est calculé**, jamais stocké.
9. **Stockage UTC**, affichage Europe/Paris (attention changements d'heure).
10. **Échec d'email ne corrompt jamais l'état** d'une réservation.
11. Aucune valeur tarifaire, fiscale, juridique ou de remboursement inventée : valeurs provisoires = configurables et marquées ; sinon → `DECISION-*`. → `private/docs/decisions/register.md`

## Tests

- Unitaires obligatoires pour : pricing, transitions, disponibilité, promos, money/dates.
- Intégration contre un vrai PostgreSQL de test (pas de mock Prisma pour les contraintes).
- Stripe et Maps mockés en unitaire ; Stripe test mode en intégration.
- E2E Playwright : devis → réservation, acceptation admin, paiement test.
- Ne jamais désactiver, `skip` ou affaiblir un test pour rendre la CI verte.

## Base de données / migrations

- Migration créée en dev, revue en PR, vérifiée en CI. Fichiers `prisma/migrations/**` = CODEOWNERS.
- Aucune migration destructive automatique en prod ; changement risqué = expand/migrate/contract.
- SQL non exprimable en Prisma (extension `btree_gist`, contraintes d'exclusion) ajouté dans la migration et documenté dans `docs/architecture/database.md`.
- Jamais de `DROP` / `TRUNCATE` hors dev local.

## Sécurité / secrets

- Aucun secret dans le code, les prompts, tickets, logs ou commits. `.env` jamais commité ; `.env.example` sans valeurs.
- Ne jamais lire ni afficher la valeur d'un secret, même pour déboguer.
- Stripe : **test mode uniquement** pour Claude.
- Logs : pas de données carte, pas de secret, PII minimisées (`bookingRef` plutôt que nom/email).
  → `docs/architecture/security.md`

## Workflow ticket → branche → PR

1. Prendre un ticket `READY` dans les Issues de `Atlas21278/avelys-private` (les PR de ce dépôt les ferment avec `Closes Atlas21278/avelys-private#N`). Vérifier la Definition of Ready.
2. Branche depuis `main` à jour. Implémenter **uniquement le scope**.
3. Tests + `pnpm lint && pnpm typecheck && pnpm test && pnpm build` verts.
4. Mettre à jour `docs/` dans la même PR si le comportement change.
5. PR : résumé, lien ticket, tests, risques, screenshots si UI.
6. Ne pas merger sa propre PR si la politique exige une approbation.

Definition of Ready / Done et format des tickets : `docs/process/tickets.md`. Permissions Claude Code du projet : `docs/process/claude-permissions.md`.

## Actions interdites

- Push direct sur `main`, force push, contournement de branch protection.
- `kubectl` en écriture, token admin Argo CD, accès production direct.
- Modifier les règles de prix, capture de paiement, clés ou webhooks Stripe sans ticket explicite.
- Rebuild d'une image sous un tag existant ; utiliser `latest` comme référence de prod.
- Ajouter une dépendance majeure ou changer de fournisseur sans ADR.

## Escalader à l'humain (ticket `DECISION-*` ou statut `BLOCKED`)

- Règle métier, tarif, fiscalité, juridique, remboursement absente ou ambiguë.
- Risque `CRITICAL` (matrice : `docs/process/tickets.md#risques`) : secrets prod, migration destructive, suppression de données, paiement prod, cluster/IAM.
- Plus de 3 cycles review/correction sur une même PR (valeur provisoire, configurable).
- Tout besoin d'accès ou de credential non déjà injecté par l'environnement.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
