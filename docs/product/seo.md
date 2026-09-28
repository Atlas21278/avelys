# SEO, publicité et analytics

Source : Master Spec §5, §17, §22.

## SEO

- Pages FR et EN indexables séparément, `hreflang` réciproques + `x-default`.
- `title`, `meta description`, `canonical`, OpenGraph par page et par langue (Metadata API Next.js).
- `sitemap.xml` (FR + EN) et `robots.txt` générés.
- Données structurées pertinentes (`LocalBusiness`/`TaxiService`, `FAQPage`, `BreadcrumbList`) — uniquement avec des informations réelles (pas de faux avis).
- Contenu **unique** par landing page : CDG, Orly, Disneyland, Versailles, chauffeur privé Paris, business (+ EN).

## Publicité

Google Ads orienté requêtes à forte intention, notamment touristes. Les landing pages sont les cibles Ads.

## Analytics

- GA4 via GTM, **chargé uniquement après consentement** (bannière cookies, Consent Mode).
- Événements : `search_started`, `quote_generated`, `checkout_started`, `booking_requested`, `booking_confirmed`, `payment_success`.
- `booking_confirmed`/`payment_success` émis côté serveur ou après confirmation fiable — pas sur simple clic.
- UTM et attribution conservées prudemment et selon consentement ; jamais de PII dans les événements.

## Performance et accessibilité

Images WebP/AVIF responsives, lazy loading hors contenu critique, JS client limité, budgets de performance en CI (valeurs à fixer en EPIC-14). Navigation clavier, labels, contraste, messages d'erreur compréhensibles, `prefers-reduced-motion`. Parcours devis/réservation utilisable sur réseau mobile moyen.
