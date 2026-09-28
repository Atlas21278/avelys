# Avelys

Plateforme de chauffeur privé premium à Paris : devis, réservation, paiement, dispatch et facturation, en français et en anglais.

- [`CLAUDE.md`](CLAUDE.md) — règles de travail, commandes, conventions.
- [`DESIGN.md`](DESIGN.md) et [`PRODUCT.md`](PRODUCT.md) — système visuel et vérité produit.
- [`docs/`](docs/) — produit, architecture, infra, ADR, processus, backlog.

## Dépôt privé associé

La spécification maîtresse (source de vérité de niveau 1), le document de tarification, le registre des décisions et le backlog (Issues) vivent dans le dépôt privé `avelys-private`. En local, il est cloné dans `private/` (ignoré par git) :

```bash
git clone https://github.com/Atlas21278/avelys-private.git private
```

Les chemins `private/…` cités dans la documentation renvoient à ce clone.
