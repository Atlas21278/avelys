# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary (confirmed 2026-09-28): international tourists** preparing a stay in Paris, often booking from abroad and in English, days or weeks ahead. Typical jobs: an airport transfer (CDG, Orly) on arrival or departure, a trip to Disneyland or Versailles, a transfer between hotel and station. They do not know Paris, may land tired, and want certainty: the price, who will pick them up, where to meet.
- Secondary audiences named in the Master Spec §1.1: French residents, business travellers and companies, hotels / concierges / restaurants, events and weddings, recurring clients.
- Internal users (back-office): the two associates acting as admin, dispatcher and drivers, often on a phone between trips.

## Product Purpose

Avelys is a premium private-driver (VTC) service in Paris run by two associates who drive themselves, with two 2026 BYD Seal electric sedans. The site builds a direct clientele so that owned bookings become the backbone of the schedule, with external platforms only filling gaps. Success: a tourist gets a price, books and receives a confirmation in their language without needing to contact anyone; the associates accept, assign and run trips from their phone.

## Positioning

Confirmed differentiators (2026-09-28):

1. **The founders drive.** The client books two named people, not an anonymous fleet.
2. **Fixed price known before booking**, computed from the actual route; no surge pricing.
3. **100 % electric**: two 2026 BYD Seal.

Bilingual FR/EN service supports these but is not claimed as unique.

## Operating Context

- Booking flow: search → server-side quote → booking request with card saved (no charge) → manual acceptance → off-session payment → confirmation → assignment → trip → invoice (`docs/product/booking.md`, `docs/product/payments.md`).
- Minimum lead time 12 h (provisional); below that the site offers direct contact instead of a failure screen.
- Guest checkout; account optional.
- French at `/`, English at `/en`.
- Back-office used mostly on smartphones.

## Capabilities and Constraints

- Stack: Next.js App Router, TypeScript, Tailwind CSS, next-intl, Prisma/PostgreSQL, Stripe, Google Maps, Resend (ADR-0003 and following).
- Prices are provisional until DEC-03 (values in the private pricing document); waiting, cancellation and no-show policies are undecided (DEC-05, DEC-06) and must not be stated as facts.
- Legal VTC mentions, company identifiers, domain name and contact channels are undecided (DEC-01b, DEC-08, DEC-20); use configurable placeholders.
- Phase 1 favours free tooling and services.

## Brand Commitments

- Name: **Avelys** (decided 2026-09-28). No logo exists yet.
- Voice (confirmed): **sober and warm**. Formal "vous" in French, short precise sentences, the hospitality of a great hotel without pompous phrasing. English equally plain and courteous.
- Binding visual constraints from the Master Spec §4: mobile-first; universe of a high-end hotel / luxury house / premium chauffeur; deep black or anthracite, ivory, greys, discreet champagne accent; elegant display type with a very legible sans-serif; real photographs only; rare, functional animation. Forbidden: generic SaaS/AI look — neon, purple, glassmorphism, bento everywhere, blurry orbs, fake counters, fake testimonials, marketing emojis.

## Evidence on Hand

- None yet: no photos of the cars or the associates, no logo, no reviews, no client list, no press.
- Future work must not fabricate testimonials, ratings, trip counts, partner logos or photos presented as real. Image slots stay explicitly provisional until real photos are supplied.

## Product Principles

1. **Certainty before commitment**: price, conditions and next step are visible before the client commits.
2. **People, not a platform**: the two drivers are the service; the product should make them present and reachable.
3. **Truth over polish**: nothing on the site may claim what is not true or not yet decided.
4. **Built for a tired traveller on a phone**: short paths, large targets, clear language in their locale.

## Accessibility & Inclusion

WCAG 2.2 AA target (Master Spec §22): keyboard navigation, form labels, sufficient contrast, understandable error messages, `prefers-reduced-motion`, usable on an average mobile network. Bilingual FR/EN.
