# VTC-008 — Permissions Claude Code du projet

- **Epic** : EPIC-02
- **Statut** : DONE (2026-09-28) — politique et écarts documentés dans `docs/process/claude-permissions.md`
- **Risque** : HIGH (garde-fous des agents)
- **Validation humaine** : **oui** (revue de l'allowlist/denylist par le propriétaire)
- **Dépendances** : VTC-002
- **Sources** : Master Spec §26, §27.2 ; `docs/process/agents.md`

## Contexte

`.claude/settings.json` active aujourd'hui uniquement des plugins. Aucune règle de permission projet.

## Objectif

Traduire les garde-fous §26 en permissions Claude Code partagées (commitées), vérifiées par la doc officielle Claude Code à jour.

## Spécification

- `.claude/settings.json` (partagé) : conserver `enabledPlugins` ; ajouter `permissions` :
  - **allow** : `pnpm lint|typecheck|test|build|format*`, `git status|diff|log|add|commit|switch|checkout -b|branch`, `gh issue view|list`, `gh pr view|list|create|diff|checks`.
  - **deny** : lecture de `.env*` (sauf `.env.example`) et de tout fichier de secrets ; `git push --force*`, `git push origin main`, `git reset --hard`, `kubectl *`, `helm install|upgrade|uninstall *`, `argocd *`, `prisma migrate reset`, `prisma db push` hors local, `rm -rf *`, `gh pr merge *`, `gh secret *`, `gh api * -X DELETE`.
  - **ask** : `git push`, `pnpm add|remove`, `prisma migrate dev`.
- `.claude/settings.local.json` ignoré par git (préférences personnelles).
- `.mcp.json` projet : aucun serveur ajouté à ce stade sauf nécessité documentée (§27.2).
- Documenter la politique dans `docs/process/agents.md`.

## Critères d'acceptation

- [ ] Syntaxe validée contre la documentation Claude Code en vigueur.
- [ ] Tentative de lecture de `.env` refusée en session (démontré).
- [ ] Tentative `git push origin main` refusée.

## Interdits / hors périmètre

Mode de contournement des permissions ; secrets dans les fichiers de config.

## Rollback / impact DB

Revert. Aucun.
