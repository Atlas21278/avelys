# ADR-0015 — Référence publique de réservation

- **Statut** : Accepté
- **Date** : 2026-09-28
- **Source** : Master Spec §20.1, §54.6

## Décision

Format `VTC-XXXXXXXX` : 8 caractères base32 Crockford (alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`), tirés par générateur cryptographique (`node:crypto`), contrainte d'unicité en base, nouvel essai borné en cas de collision. Saisie tolérante (casse ; `O` lu `0` ; `I`/`L` lus `1`).

## Conséquences

32⁸ ≈ 1,1 × 10¹² combinaisons : non devinable pour le volume visé. La référence seule ne donne pas accès aux données d'une réservation (lien signé requis, voir `docs/architecture/security.md`).
