---
name: Avelys
description: Premium private drivers in Paris, every trip laid out as a travel-guide itinerary.
colors:
  ink: "#1f2124"
  ink-raised: "#34373c"
  paper: "#f4efe6"
  paper-deep: "#eae3d6"
  graphite: "#5b5852"
  rule: "#8c877e"
  hairline: "#d6cec0"
  champagne: "#b8996a"
  champagne-deep: "#7a5f32"
  rubric: "#9c2b20"
  on-ink-muted: "#a8a298"
typography:
  display:
    fontFamily: "Bodoni Moda, Bodoni 72, Didot, serif"
    fontSize: "clamp(2.5rem, 7vw, 4.75rem)"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "lnum"
    fontVariation: "'opsz' 11"
  headline:
    fontFamily: "Bodoni Moda, Bodoni 72, Didot, serif"
    fontSize: "clamp(2rem, 6vw, 2.75rem)"
    fontWeight: 500
    lineHeight: 1.05
    fontFeature: "lnum"
    fontVariation: "'opsz' 11"
  figure:
    fontFamily: "Bodoni Moda, Bodoni 72, Didot, serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "lnum"
    fontVariation: "'opsz' 11"
  title:
    fontFamily: "Bodoni Moda, Bodoni 72, Didot, serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    fontFeature: "lnum"
    fontVariation: "'opsz' 11"
  body:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "lnum"
  body-sm:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.08em"
  button:
    fontFamily: "Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.5
rounded:
  none: "0px"
  print: "2px"
  full: "9999px"
spacing:
  hair: "6px"
  gutter: "16px"
  gutter-sm: "24px"
  gutter-lg: "40px"
  block: "32px"
  section: "80px"
  measure: "72rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.print}"
    padding: "0 20px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.ink-raised}"
  button-primary-lg:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.print}"
    padding: "0 28px"
    height: "56px"
  button-primary-disabled:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.graphite}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.print}"
    padding: "0 20px"
    height: "48px"
  button-secondary-hover:
    backgroundColor: "{colors.paper-deep}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    padding: "0 4px"
    height: "48px"
  field-input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "8px 0"
    height: "48px"
  field-label:
    textColor: "{colors.graphite}"
    typography: "{typography.label}"
  price-slot:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "12px 16px"
    height: "104px"
  route-stop-marker:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: "28px"
  route-stop-marker-last:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.full}"
    size: "28px"
  guide-page:
    backgroundColor: "{colors.paper-deep}"
    rounded: "{rounded.none}"
    padding: "24px"
  signet:
    textColor: "{colors.champagne}"
    width: "14px"
    height: "32px"
---

# Design System: Avelys

## Overview

**Creative North Star: "Le Guide de voyage"**

Avelys is set like a travel guide from the era of the Guides Bleus: an anthracite cloth binding, matte ivory pages, graphite annotations in the margin, and a single champagne ribbon bookmark marking where the reader is. Every trip is read as a guide itinerary: numbered stops, the distance and duration between them on a dot leader, and a fixed price that owns a drawn place on the page before it exists. The system is quiet and exact rather than glamorous; luxury comes from print discipline, not from gold on black.

Density is that of a reference page: generous margins, 1px rules instead of boxes, one high-contrast serif (Bodoni Moda) for titles, place names and figures, and one plain grotesque (Schibsted Grotesk) for everything the reader must act on. Depth is almost entirely flat; the one lifted object is the itinerary card, a guide page lying on the page. Motion is rare and functional: state transitions settle in 200ms, and a chosen route draws itself solid once.

The world refuses the category default of a black sedan at night under a gold serif. Imagery is real photography only; until real photographs exist, image slots stay visibly labelled as provisional.

**Key Characteristics:**

- Ink binding, ivory pages, graphite annotations, one champagne ribbon per view.
- Solid means chosen, dotted means possible.
- The price owns a fixed, drawn slot that never moves or resizes.
- Fields are ledger lines, not boxes; corners are square printed corners.
- Bodoni for place names and figures, Schibsted Grotesk for reference text and controls.

## Colors

A warm print palette: near-black ink on ivory paper, with greys that read as pencil and one metallic ribbon used as a bookmark, not a colour.

### Primary

- **Anthracite Binding** (ink): all body text, headings, the primary action, the dark header band, focus rings and the committed route line. It is the only dark field in the system (14.09:1 on paper).
- **Raised Binding** (ink-raised): hover state of the primary button only.

### Secondary

- **Champagne Ribbon** (champagne): the signet bookmark and text selection. It marks the reader's current place (active nav item, selected option, the itinerary card) and nothing else. At 2.35:1 on paper it is never text on paper; on ink it reaches 6.00:1.
- **Deep Champagne** (champagne-deep): the only champagne permitted as text on paper, for accented words (5.22:1).

### Tertiary

- **Rubric Red** (rubric): errors only, as in a printed rubric: the error message, its mark and the invalid field's underline (6.60:1 on paper).

### Neutral

- **Ivory Page** (paper): the page background; text on ink uses it too.
- **Deep Ivory** (paper-deep): the itinerary card surface, secondary button hover, scrollbar track.
- **Graphite Annotation** (graphite): hints, details, captions, labels, placeholders, disabled text (6.19:1 on paper).
- **Ruled Line** (rule): the 1px edge of every field, dotted route legs, dot leaders, the empty price slot's dashed border, link underlines at rest. At 3.12:1 it meets the non-text contrast floor for a control edge.
- **Hairline** (hairline): quiet dividers, swatch and table borders, disabled button fill and disabled field edge. Decorative only, never a control's sole boundary.
- **Muted Ink Annotation** (on-ink-muted): secondary text on the ink band (6.37:1 on ink).

### Named Rules

**The One Ribbon Rule.** One champagne ribbon per view, and it marks the current place. Champagne is never text on paper; accented text on paper uses champagne-deep. The state the ribbon marks is also carried by text or ARIA.

**The Single Binding Rule.** Ink is the only dark field. No second dark surface, no dark cards on the page.

**The Rubric Rule.** Rubric red means an error and nothing else.

## Typography

**Display Font:** Bodoni Moda (with Bodoni 72, Didot, serif), self-hosted via next/font with the opsz axis
**Body Font:** Schibsted Grotesk (with ui-sans-serif, system-ui, sans-serif), self-hosted via next/font

**Character:** A high-contrast Didone for the names of places and the price, like a guide's headings, against a sturdy, plain grotesque for reference text and controls that must stay legible to a tired traveller on a phone.

### Hierarchy

- **Display** (Bodoni, 500, clamp(2.5rem, 7vw, 4.75rem), line-height 1, -0.02em, opsz pinned at 11): the page promise and page titles.
- **Headline** (Bodoni, 500, clamp(2rem, 6vw, 2.75rem), line-height 1.05, opsz pinned at 11): section titles. The same size set with the pinned figure cut serves route headlines.
- **Figure** (Bodoni, 600, 2.25rem, line-height 1, opsz pinned at 11): the price inside the price slot.
- **Title** (Bodoni, 600, 1.25rem, line-height 1.25, opsz pinned at 11): place names on a route line.
- **Body** (Schibsted Grotesk, 400, 1rem, line-height 1.55): reference text; lead paragraphs step up to 1.125rem. Keep paragraphs to 65ch; text on the ink band to about 46ch.
- **Small** (Schibsted Grotesk, 400, 0.875rem): hints, stop details, leg distances and durations, error messages.
- **Label** (Schibsted Grotesk, 600, 0.8125rem, 0.08em, uppercase): field labels, price-slot captions, table captions and card headings that label data.
- **Button** (Schibsted Grotesk, 600, 0.9375rem; 1rem with 0.01em at the large size).

Headings balance their lines; paragraphs use pretty wrapping.

### Named Rules

**The Pinned Hairline Rule.** Bodoni is always set at its text optical size, opsz 11: titles at weight 500, figures and place names at weight 600. The display optical sizes thin the hairlines until they vanish on ivory (owner feedback, 2026-09-28), and hyphens and the € crossbars must survive. Never use automatic optical sizing or weight 400.

**The Lining Figures Rule.** Figures are lining, not tabular: Schibsted Grotesk's tabular comma takes a full figure width and breaks French decimals ("32 , 4"). Tables, times and data set lining numerals.

**The Label, Not Kicker Rule.** Small caps label controls and data. They never sit above a heading as an eyebrow.

## Layout

A single page measure: a 72rem sheet centred on desktop, with 16px gutters on phones, 24px from the small breakpoint and 40px from the large one. Sections stack in one column with 80px between them and 32px between a section title and its content. Mobile first: forms become two columns from the small breakpoint (640px), and the itinerary pairs (card beside route and price) from the medium breakpoint (768px). On desktop the promise takes the left column and the itinerary card sits on the right as a guide page. Primary actions keep a 48px minimum target (56px at the large size) and sit in the thumb zone on phones. Field internals are tight: 6px between label, control and message.

## Elevation & Depth

The system is flat: depth comes from rules and tonal paper (paper against paper-deep), not from shadows. One soft, ambient shadow exists, and it belongs to the itinerary card, a guide page resting on the page.

### Shadow Vocabulary

- **Page** (`box-shadow: 0 1px 1px rgb(31 33 36 / 0.06), 0 12px 32px -12px rgb(31 33 36 / 0.22)`): the paper-deep itinerary card only.

### Named Rules

**The One Page Lift Rule.** Only the guide-page card is lifted. Buttons, fields, the price slot and everything else stay flat and are drawn with 1px lines.

## Shapes

Square printed corners. Buttons take a barely softened 2px print corner; fields, the price slot and the itinerary card have no radius at all. The only round forms are the numbered stop markers on a route line. Lines carry meaning: a solid ink line is a committed choice, a dotted rule line is a possibility, and a dashed rule border is a place reserved for something not yet known. The signet is a flat champagne ribbon with a swallow-tail notch, hanging from the top edge of the card it marks.

**The Solid Means Chosen Rule.** Committed routes and priced slots draw solid in ink; possible routes stay dotted and an empty price slot stays dashed.

## Components

### Buttons

Printed and firm, never pill-shaped.

- **Shape:** print corner (2px).
- **Primary:** ink fill, paper text, semibold 0.9375rem, 48px tall with 20px sides; the large size is 56px tall with 28px sides. Hover lifts to ink-raised.
- **Secondary:** 1px ink border, ink text, transparent; hover fills with deep ivory.
- **Quiet:** an ink word with a 1px rule underline offset 6px; hover darkens the underline to ink.
- **Transitions:** colour only, 200ms on the settle curve (cubic-bezier(0.16, 1, 0.3, 1)).
- **Focus:** the global ring, 2px solid ink offset 3px.
- **Disabled:** hairline fill (primary) or hairline border (secondary), graphite text, not-allowed cursor.
- **Loading:** keeps the variant's colours, keeps the label, adds a small spinning progress mark and blocks repeat submits. In progress never reads as unavailable.

### Inputs / Fields

A ledger line rather than a box.

- **Style:** transparent, no radius, no side padding, 48px minimum height, a single 1px rule underline. The label sits above in the Label style in graphite; an optional marker follows in normal case.
- **Hover:** the underline turns ink at 1px.
- **Focus:** a 3px ink underline (1px border plus a 2px shadow line). Focus overrides the error colour; the error remains announced by its message and aria-invalid.
- **Error:** a 2px rubric underline when not focused, with a rubric message below led by a drawn circle mark.
- **Hint:** graphite small text below the control.
- **Disabled:** graphite text on a hairline underline.
- **Select:** the same ledger line with a thin drawn chevron in ink at the right.

### Text Links

Ink text with a 1px rule underline offset 5px; hover darkens the underline to ink.

### Route Line

The signature component: a guide itinerary.

- Numbered stops in 28px round markers: ivory with an ink ring for each stop, solid ink with ivory numeral for the destination.
- Place names in the Title style, details in graphite small text.
- Each leg shows distance on the left and duration on the right joined by a dotted rule dot leader.
- The connector between stops is a dotted rule while the route is possible. When committed, an ink line draws itself solid once from the top (700ms, settle curve, 120ms stagger per leg); reduced motion skips the draw.

### Price Slot

The price owns a fixed, drawn place from the first view.

- A 104px-minimum box with a Label caption; empty, it has a dashed rule border and a short 1px graphite rule where the figure will sit, with a graphite note on the right.
- Priced, the border turns solid ink and the figure appears in the Figure style. The slot never moves or resizes; the figure is announced politely.

### Guide Page (itinerary card)

Deep ivory surface, square corners, 24px padding, the Page shadow, and the signet hanging from its top edge near the right.

### Signet

A champagne ribbon bookmark (14 by 32px). Decorative only; one per view.

## Do's and Don'ts

### Do:

- **Do** keep one champagne ribbon per view, marking the current place, and also convey that state in text or ARIA.
- **Do** use champagne-deep for accented text on paper; champagne on paper stays under 3:1 (2.35:1).
- **Do** set every Bodoni use at opsz 11: titles at weight 500, figures and place names at weight 600.
- **Do** set figures as lining numerals.
- **Do** draw committed routes and known prices solid in ink, possible routes dotted, and the empty price slot dashed.
- **Do** make focus the strongest line on a field: a 3px ink underline that wins over the error colour.
- **Do** keep a loading button in its variant's colours with its label visible.
- **Do** keep primary targets at 48px minimum (56px for the main call to action).

### Don't:

- **Don't** set champagne as text on paper, or add a second ribbon, or use champagne as a general accent.
- **Don't** place small-caps labels above a heading as an eyebrow; they label controls and data only.
- **Don't** use tabular figures where a decimal comma appears.
- **Don't** box fields or round them; the field is a 1px ledger line.
- **Don't** round corners beyond the 2px print corner; only route stop markers are circular.
- **Don't** introduce a second dark surface or a second shadow; ink is the only dark field and the guide page is the only lifted object.
- **Don't** use rubric red for anything other than errors.
- **Don't** fall back to the black-sedan-at-night, gold-serif-on-black look.
