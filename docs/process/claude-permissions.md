# Permissions Claude Code du projet

Source : Master Spec §26, §27.2 ; ticket VTC-008. Fichier : `.claude/settings.json` (partagé, CODEOWNERS).
Syntaxe vérifiée le 2026-09-28 sur la documentation officielle (code.claude.com/docs/en/permissions).

## Principes

- Ordre d'évaluation : **deny → ask → allow** ; une règle `allow` ne peut pas créer d'exception à un `deny`.
- Les règles `Bash(...)`/`PowerShell(...)` comparent le texte de la commande. Elles sont **contournables** (`git -C . push`, `sh -c '…'`, chemin absolu du binaire) : ce sont des défenses en profondeur, pas un bac à sable. Les vraies barrières restent la protection de `main` côté GitHub (DEC-23), le hook `.githooks/pre-push`, les permissions minimales des tokens et l'absence de credentials de production sur le poste.
- Les règles `Read(...)`/`Edit(...)` suivent la sémantique gitignore ; `Edit` couvre aussi les redirections shell (`> fichier`).
- `.claude/settings.local.json` (préférences personnelles) est ignoré par git.

## Autorisé sans demande

Scripts pnpm du projet (`install`, `lint`, `typecheck`, `test`, `build`, `format`, `format:check`), Vitest/ESLint via `pnpm exec`, git en lecture et `add`/`commit`/`switch`/`branch`/`fetch`/`pull --ff-only`, `gh issue|pr view/list`, `gh pr diff|checks|create`, `gh run list|view|watch`.

## Refusé

| Catégorie             | Règles                                                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secrets               | lecture de `.env`, `.env.local`, `.env.*.local`, `.env.{development,test,staging,production}`, `**/*.pem`, `**/secrets/**` ; écriture de `.env`, `.env.local`, `.env.production`. `.env.example` reste lisible.              |
| Git                   | push forcé, push vers `main` (dont `HEAD:main`), `git reset --hard`, modification de `core.hooksPath`                                                                                                                        |
| Cluster / déploiement | `kubectl`, `helm install/upgrade/uninstall/rollback`, `argocd`                                                                                                                                                               |
| Base                  | `prisma migrate reset`                                                                                                                                                                                                       |
| Fichiers              | `rm -rf`                                                                                                                                                                                                                     |
| GitHub                | `gh secret`, `gh pr merge --admin` (contournement du ruleset), modification des rulesets via `gh api` ou `scripts/apply-ruleset.sh`, `gh variable`, `gh repo delete`, changement de visibilité du repo, `gh api` en `DELETE` |

Les règles git, cluster et GitHub sensibles existent aussi en `PowerShell(...)` : le poste de développement est sous Windows.

## Écarts assumés par rapport au ticket

- **`gh pr merge` n'est pas refusé.** Le propriétaire a donné l'autonomie à Claude le 2026-09-28 (« ne me demande pas de permission »). Règle de conduite : merge en squash **uniquement** quand `ci`, `secrets` et `deps` sont verts. Le ruleset de `main` (actif) l’impose côté GitHub. Passer à 1 approbation + revue CODEOWNERS quand le second associé aura un compte GitHub.
- **Pas de règles `ask`** (`git push`, `pnpm add`, `prisma migrate dev`) : elles déclencheraient des demandes, ce que le propriétaire a refusé. Le push vers une branche de travail reste possible ; vers `main`, il est refusé.
- Pas de `.mcp.json` projet : aucun serveur MCP n'est nécessaire à ce stade (§27.2).

## Vérifications faites (2026-09-28)

- Lecture de `.env` par l'outil Read → refusée.
- Création de `.env` par redirection shell → refusée.
- `git push origin main` → refusé.
