# ADR-0005 — Authentification Better Auth et RBAC

- **Statut** : Accepté
- **Date** : 2026-09-28
- **Source** : Master Spec §13, §18, §54.2

## Décision

- Better Auth, sessions stockées en base (adaptateur Prisma).
- Admin/Dispatcher/Driver : email + mot de passe ; **2FA obligatoire pour les rôles admin** (périmètre exact pour DISPATCHER : DEC-15, défaut : obligatoire).
- Clients : magic link email ; compte facultatif ; guest checkout.
- Rôles : `ADMIN`, `DISPATCHER`, `DRIVER`, `CUSTOMER`, vérifiés côté serveur dans `src/server/`.
- Rate limiting sur les endpoints d'auth.

## Conséquences

Pas de fournisseur d'identité externe payant. L'email transactionnel (Resend) devient une dépendance de l'auth client.

## Alternatives écartées

Auth.js (2FA moins intégrée) ; fournisseurs SaaS (coût, données hors UE).
