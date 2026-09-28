# VTC-005 — Configuration d'environnement validée par Zod

- **Epic** : EPIC-01
- **Statut** : DONE (2026-09-28) — Zod 4.6 ; variables publiques : schéma séparé créé avec la première variable `NEXT_PUBLIC_*`
- **Risque** : MEDIUM (secrets)
- **Validation humaine** : non
- **Dépendances** : VTC-002
- **Sources** : Master Spec §18, §42, §54.2 ; `docs/architecture/security.md`

## Objectif

Une seule porte d'entrée typée pour les variables d'environnement, qui échoue tôt et clairement sans jamais afficher de valeur.

## Spécification technique

- `src/lib/env.ts` : schéma Zod séparant variables **serveur** et **publiques** (`NEXT_PUBLIC_*`) ; import serveur protégé par `server-only`.
- Au lot 1 : `NODE_ENV`, `APP_ENV` (`local|ci|staging|production`), `APP_URL`. Les variables Stripe/Maps/Resend/DB seront ajoutées par leurs tickets respectifs.
- Message d'erreur listant les **noms** des variables invalides, jamais leurs valeurs.
- Option `SKIP_ENV_VALIDATION` réservée au build Docker, documentée. _Remplacée par VTC-015 : la validation se fait au premier usage (`serverEnv()`), le build n’a plus besoin des variables._
- `.env.example` commité, sans aucune valeur sensible, commenté.

## Critères d'acceptation

- [ ] Démarrage avec une variable requise manquante → erreur explicite nommant la variable.
- [ ] Aucune valeur n'apparaît dans l'erreur (test unitaire).
- [ ] Importer `env` serveur depuis un composant client échoue au build.
- [ ] `.env` ignoré par git ; `.env.example` présent.

## Interdits / hors périmètre

Lire, créer ou afficher de vrais secrets. Intégrer un secret manager (EPIC-05).

## Rollback / impact DB

Revert. Aucun.
