# ADR-0010 — Google Maps Platform

- **Statut** : Accepté
- **Date** : 2026-09-28
- **Source** : Master Spec §7

## Décision

Google Maps Platform pour autocomplete (Places), geocoding et routing (Routes API). Clé browser (restreinte domaine + API autocomplete) et clé server (restreinte API/IP) séparées. Calcul d'itinéraire côté serveur uniquement, via un adaptateur `src/integrations/maps` avec timeout, retry borné et gestion des quotas. Distance routière et durée stockées dans le snapshot.

## Conséquences

Coût à l'usage : quotas et alertes budget (DEC-17). L'adaptateur permet de remplacer le fournisseur par un ADR ultérieur.
