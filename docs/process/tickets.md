# Système de tickets

Source : Master Spec §24, §44, §47, §48.

## Préfixes

| Préfixe        | Usage                                                                | Branche                |
| -------------- | -------------------------------------------------------------------- | ---------------------- |
| `EPIC-xx`      | Regroupement                                                         | —                      |
| `VTC-xxx`      | Produit / applicatif / outillage repo                                | `feature/VTC-xxx-slug` |
| `INFRA-xxx`    | CI, Docker, Kubernetes, GitOps                                       | `infra/INFRA-xxx-slug` |
| `BUG-xxx`      | Anomalie                                                             | `fix/BUG-xxx-slug`     |
| `DECISION-xxx` | Décision humaine requise (voir `private/docs/decisions/register.md`) | —                      |

## Statuts

`BACKLOG` · `NEEDS_DECISION` · `READY` · `IN_PROGRESS` · `PR_OPEN` · `REVIEW` · `BLOCKED` · `READY_TO_MERGE` · `DONE`
(Labels GitHub `status:*` créés par VTC-007.)

## Definition of Ready

Objectif explicite · périmètre et hors périmètre · critères d'acceptation testables · dépendances identifiées · documentation source référencée · aucune décision métier bloquante ouverte · risque indiqué · rollback/impact DB indiqué si nécessaire.

## Definition of Done

Critères satisfaits · tests ajoutés/non cassés · lint/typecheck/build verts · docs à jour · review Claude passée · scan sécurité applicable passé · migration validée si présente · preview/staging validé selon type · aucune modification hors scope inexpliquée · traçabilité ticket → PR → commits.

## Format obligatoire

```markdown
# <ID> — <Titre>

- **Epic** :
- **Statut** :
- **Risque** : LOW | MEDIUM | HIGH | CRITICAL
- **Validation humaine** : oui | non
- **Dépendances** :
- **Sources** : (sections spec, docs, ADR)

## Contexte

## Objectif

## Résultat attendu / user story

## Spécification fonctionnelle

## Spécification technique (si nécessaire)

## Critères d'acceptation

- [ ] …

## Tests attendus

## Fichiers / modules probables

## Interdits / hors périmètre

## Rollback / impact DB
```

## Risques

| Niveau   | Exemples                                                                                | Règle                                     |
| -------- | --------------------------------------------------------------------------------------- | ----------------------------------------- |
| LOW      | UI, texte, tests, refactor local                                                        | Automatisable si checks verts             |
| MEDIUM   | API interne, logique non financière                                                     | Review obligatoire                        |
| HIGH     | Pricing, auth, paiement, migration additive importante, infra                           | Review renforcée + staging                |
| CRITICAL | Secrets prod, migration destructive, suppression de données, paiement prod, cluster/IAM | Approbation humaine explicite obligatoire |
