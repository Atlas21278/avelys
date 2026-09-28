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

## Pages

| Route FR       | Route EN       | But                                                                |
| -------------- | -------------- | ------------------------------------------------------------------ |
| `/`            | `/en`          | Accueil + devis                                                    |
| `/services`    | `/en/services` | Services                                                           |
| `/entreprises` | `/en/business` | Offre B2B                                                          |
| `/flotte`      | `/en/fleet`    | Flotte                                                             |
| `/a-propos`    | `/en/about`    | Confiance                                                          |
| `/contact`     | `/en/contact`  | Contact                                                            |
| `/reservation` | `/en/booking`  | Parcours réservation                                               |
| `/compte`      | `/en/account`  | Espace client                                                      |
| `/admin`       | —              | Back-office protégé (FR)                                           |
| Landing pages  | équivalents EN | CDG, Orly, Disneyland, Versailles, chauffeur privé Paris, business |
| Légal          | équivalents EN | Mentions légales, confidentialité, cookies, CGV (DEC-09, DEC-10)   |

> Slugs EN traduits : décidé (DEC-21, 2026-09-28). Routage, langue par défaut et hreflang : `docs/architecture/i18n.md`.

## Compte client et B2B

Compte facultatif ; proposé après réservation. Historique, trajets futurs, factures, adresses, préférences, « réserver à nouveau ». Modèle `Company` + `CompanyMember` préparé ; collaborateurs, rôles et facturation mensuelle ultérieurs.
