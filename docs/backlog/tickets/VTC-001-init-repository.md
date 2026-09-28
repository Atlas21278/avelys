# VTC-001 — Initialiser git et le repository GitHub

- **Epic** : EPIC-01
- **Statut** : DONE (2026-09-28)
- **Risque** : MEDIUM
- **Validation humaine** : accordée par le propriétaire (autonomie donnée le 2026-09-28)
- **Dépendances** : —
- **Sources** : Master Spec §23, §29, §54.1 ; ADR-0002

## Contexte

Le dossier de travail contient la Master Spec, `CLAUDE.md` et `docs/` mais n'est pas un dépôt git.

## Objectif

Disposer d'un dépôt git local et d'un repository GitHub privé `avelys` avec `main` comme branche par défaut, contenant l'état initial.

## Spécification fonctionnelle

- `git init -b main` ; `.gitignore` (Node, Next.js, `.env*` sauf `.env.example`, `.claude/settings.local.json`, OS/IDE).
- `.gitattributes` (`* text=auto eol=lf`) — le poste de dev est Windows.
- `README.md` court : pitch, lien `CLAUDE.md`, lien `docs/`.
- Déplacer `private/Master_Specification_VTC.md` vers `docs/spec/` **ou** le laisser à la racine (au choix du propriétaire, mettre à jour les liens) ; `archive/` versionné tel quel.
- Commit initial `chore: VTC-001 bootstrap repository and documentation`.
- Création du repo GitHub privé (`gh repo create`) et push de `main`. Spec laissée à la racine.

## Critères d'acceptation

- [ ] `git status` propre après commit initial.
- [ ] Aucun fichier `.env` ni secret versionné (`git ls-files` vérifié).
- [ ] Repo GitHub privé existe, `main` par défaut, contenu poussé.
- [ ] Fins de ligne LF dans l'index.

## Tests attendus

Vérification manuelle + `gitleaks detect` local si disponible.

## Interdits / hors périmètre

Branch protection (VTC-006), CI (INFRA-001), scaffold applicatif (VTC-002).

## Rollback / impact DB

Aucun.
