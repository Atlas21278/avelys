# Kubernetes, Docker et Helm

Source : Master Spec §31–§34, §36, §40. ADR-0013, ADR-0014.

## Image Docker

- Dockerfile multi-stage : `deps` (pnpm fetch) → `build` (`next build`, `output: 'standalone'`) → `runtime` minimal.
- Utilisateur non-root, système de fichiers en lecture seule si possible.
- Aucun secret dans les layers ni en `ARG`.
- Labels OCI `org.opencontainers.image.source` / `revision`.
- Tag = SHA Git (+ SemVer à la release) ; le **digest** est la référence de déploiement ; `latest` jamais utilisé comme référence de prod.
- Scan Trivy + SBOM ; échec selon politique = promotion bloquée.

## Environnements

| Namespace        | Usage                            | Sync Argo                      |
| ---------------- | -------------------------------- | ------------------------------ |
| `avelys-staging` | Proche prod, données non réelles | Auto                           |
| `avelys-prod`    | Clients réels                    | Manuel / PR approuvée (DEC-16) |

Credentials séparés par namespace. ResourceQuota/LimitRange si pertinent.

## Ressources du chart `charts/avelys`

Deployment (web+API) · Service · Ingress + TLS (cert-manager ou offre fournisseur) · ConfigMap (config non sensible) · Secrets via mécanisme sécurisé (External Secrets / Sealed Secrets — choix avec DEC-12) · Job de migration Prisma (hook/sync wave) · CronJobs internes · ServiceAccount dédié.

- Probes : `startupProbe` + `livenessProbe` → `/api/health` ; `readinessProbe` → `/api/health/ready`.
- `requests`/`limits` explicites.
- PodDisruptionBudget si ≥ 2 replicas. HPA seulement après mesures.

## Sécurité cluster

RBAC minimal · ServiceAccounts dédiés · NetworkPolicies si supportées · Pod Security Standards `restricted` · images uniquement depuis GHCR · pas de conteneur privilégié · aucun secret en clair dans Git.

## Helm

Chart versionné ; `values.yaml` commun + overrides par environnement dans le repo GitOps ; aucune valeur secrète ; templates simples ; `helm lint` + `helm template` en CI ; changements incompatibles accompagnés de notes de migration.

## Base de données

**Pas de PostgreSQL en simple pod.** Recommandation : PostgreSQL managé avec PITR en région France (ADR-0014, DEC-12).
