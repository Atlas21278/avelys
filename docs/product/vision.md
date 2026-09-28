# Vision produit

Source : Master Spec §1–§6, §13.

## Contexte

Service de chauffeur privé / VTC premium à Paris. Les deux associés conduisent eux-mêmes au lancement avec deux BYD Seal 2026 électriques. Objectif : construire une clientèle directe pour que les réservations propriétaires deviennent le squelette du planning ; les plateformes externes (Uber, Bolt) comblent les temps morts.

## Cibles

Touristes internationaux · particuliers FR/résidents · voyageurs d'affaires et entreprises · hôtels, restaurants, conciergeries · événements/mariages · clients récurrents.

## Prestations V1

Transfert adresse à adresse · CDG ↔ Paris · Orly ↔ Paris · Paris ↔ Disneyland · Paris ↔ Versailles · gares et hôtels · mise à disposition (2 h / 4 h / 8 h / journée / personnalisé) · longue distance · business · événements/mariages sur devis.

## Proposition de valeur

- Prix connu avant confirmation (trajets éligibles au devis automatique).
- Réservation anticipée simple, sans compte obligatoire.
- Paiement sécurisé.
- Service premium, communication FR/EN, expérience rassurante pour un touriste.

## Périmètre

| V1                                                                                                                                                                                                                                                                                              | Hors V1                                                                                                                                                      | Phase 2                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Site public FR/EN responsive, devis, réservation, Stripe, validation manuelle, affectation chauffeur/véhicule, planning, comptes clients facultatifs, dashboard interne, emails, factures PDF, promotions, landing pages SEO/Ads, analytics, admin chauffeurs/véhicules/tarifs/indisponibilités | App mobile native, GPS temps réel, dispatch automatique avancé, API Uber/Bolt, marketplace, chatbot IA, fidélité complexe, notation chauffeur, surge pricing | Sync Notion ↔ GitHub, Incident Agent automatisé |

## Parcours de référence

```
Recherche → Devis → Demande (+ enregistrement carte) → Validation manuelle
→ Paiement → Confirmation → Affectation chauffeur/véhicule → Course → Fin → Facture
```

## Direction artistique

Mobile-first. Univers hôtel haut de gamme / maison de luxe. Noir ou anthracite profond, ivoire, gris, accent champagne discret. Display élégante + sans-serif lisible. Vraies photos. Animations rares et fonctionnelles, `prefers-reduced-motion` respecté.

**Interdits** : néon, violet, glassmorphism, bento généralisé, orbes floues, faux compteurs, faux témoignages, emojis marketing.

Accueil : header (Services, Entreprises, Flotte, À propos, Contact, FR/EN, Réserver) ; hero avec module de recherche visible (départ, destination, date, heure, passagers, bagages) ; CTA « Voir le prix » / « Get a quote » ; sections services, avantages, flotte, destinations, business, FAQ, footer.

Mise en œuvre (VTC-014) :

- Le module de recherche n'affiche **aucun prix**. « Voir le prix » mène à la page réservation (`/reservation`, `/en/booking`) avec les champs remplis en paramètres d'URL : `pickup`, `dropoff`, `date` (`AAAA-MM-JJ`), `time` (`HH:MM`, heure de Paris), `passengers` (entier ≥ 1), `luggage` (entier ≥ 0). Aucun maximum de capacité (DEC-02) et aucun champ montant : schéma Zod et construction du lien dans `src/lib/booking-search.ts`, réutilisables par la page réservation pour relire ces paramètres. Sans JavaScript, le formulaire reste un simple `GET` vers la même page.
- Header et footer partagés : `src/components/site/`. Coordonnées, SIREN, n° VTC, assurance et contact direct viennent de `src/lib/site-identity.ts` ; tant qu'une valeur vaut `null`, le footer affiche « À confirmer (provisoire — DEC-08 / DEC-20) ». Depuis VTC-018, les liens du header et du footer (y compris les pages légales) mènent tous à une page existante.
- FAQ limitée aux faits décidés (sans compte, FR/EN, validation manuelle, paiement Stripe débité après acceptation) : rien sur le prix, l'annulation, le remboursement, l'attente ou le no-show (DEC-03, DEC-05, DEC-06).
- Emplacement photo de la flotte marqué provisoire tant qu'aucune vraie photo n'existe.

## Pages

| Route FR            | Route EN           | But                                                                | État (VTC-018)                                                               |
| ------------------- | ------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `/`                 | `/en`              | Accueil + devis                                                    | Livrée (VTC-014)                                                             |
| `/services`         | `/en/services`     | Services                                                           | Prestations V1, sans prix                                                    |
| `/entreprises`      | `/en/business`     | Offre B2B                                                          | Offre en préparation, aucune condition commerciale (DEC-20)                  |
| `/flotte`           | `/en/fleet`        | Flotte                                                             | « BYD Seal », sans finition ni capacité (DEC-02)                             |
| `/a-propos`         | `/en/about`        | Confiance                                                          | Faits décidés uniquement                                                     |
| `/contact`          | `/en/contact`      | Contact                                                            | Canaux `site-identity` en placeholders (DEC-20), sans formulaire             |
| `/reservation`      | `/en/booking`      | Parcours réservation                                               | « En préparation » : relit la recherche de l'accueil, sans prix (EPIC-08/09) |
| `/compte`           | `/en/account`      | Espace client                                                      | Slug réservé, page avec EPIC-13                                              |
| `/admin`            | —                  | Back-office protégé (FR)                                           | VTC-016                                                                      |
| Landing pages       | équivalents EN     | CDG, Orly, Disneyland, Versailles, chauffeur privé Paris, business | EPIC-14                                                                      |
| `/mentions-legales` | `/en/legal-notice` | Mentions légales                                                   | Champs `site-identity` en placeholders (DEC-08 / DEC-20)                     |
| `/confidentialite`  | `/en/privacy`      | Politique de confidentialité                                       | En cours de rédaction (DEC-11)                                               |
| `/cookies`          | `/en/cookies`      | Politique cookies                                                  | En cours de rédaction (DEC-11) ; aucun cookie non essentiel posé (EPIC-14)   |
| `/cgv`              | `/en/terms`        | Conditions générales de vente                                      | En validation juridique (DEC-10) ; médiateur à confirmer (DEC-09)            |

> Slugs EN traduits : décidé (DEC-21, 2026-09-28). Routage, langue par défaut et hreflang : `docs/architecture/i18n.md`.

Mise en œuvre (VTC-018) :

- Chaque page publique : Server Component sous `src/app/[locale]/`, cadre commun `SitePage` (header, footer, un `h1`), metadata `pageMetadata()` (`src/i18n/page-metadata.ts` : `title`, `description`, `canonical`, hreflang `fr`/`en`/`x-default`). Textes sous `Pages.<page>` dans les catalogues.
- Tout contenu provisoire passe par `ProvisionalNotice` (`src/components/site/provisional-notice.tsx`) ou porte l'attribut `data-provisional="DEC-…"` : il se retrouve par recherche et affiche la décision ouverte. Aucun texte juridique, tarifaire, de capacité ou de contact n'est inventé.
- `/reservation` relit les paramètres avec `readBookingSearch()` (`src/lib/booking-search.ts`) : chaque champ est validé seul, un champ invalide est ignoré, un paramètre répété garde sa première valeur ; jamais d'erreur, jamais de montant.
- `src/i18n/routes.test.ts` vérifie que chaque entrée de `pathnames` a sa page et un slug EN, et que chaque lien du header et du footer mène à une page existante.

## Compte client et B2B

Compte facultatif ; proposé après réservation. Historique, trajets futurs, factures, adresses, préférences, « réserver à nouveau ». Modèle `Company` + `CompanyMember` préparé ; collaborateurs, rôles et facturation mensuelle ultérieurs.
