import { Text } from "@react-email/components";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import type { Locale } from "@/i18n/routing";
import { SITE_IDENTITY_DECISIONS } from "@/lib/site-identity";

import { EmailLayout } from "./layout";
import { renderEmail } from "./render";

function layout(locale: Locale) {
  return createElement(
    EmailLayout,
    { locale, preview: locale === "fr" ? "Aperçu du message" : "Message preview" },
    createElement(Text, null, locale === "fr" ? "Contenu du modèle." : "Template body."),
  );
}

describe("EmailLayout", () => {
  it("renders the French layout", async () => {
    const { html, text } = await renderEmail(layout("fr"));
    expect(html).toContain('lang="fr"');
    expect(html).toContain(`data-provisional="${SITE_IDENTITY_DECISIONS}"`);
    expect(text).toMatchInlineSnapshot(`
      "Avelys

      Contenu du modèle.

      ----------------------------------------

      Chauffeur privé premium à Paris, conduit par ses deux fondateurs.

      Vous recevez cet email au sujet de votre réservation Avelys.

      Société et contact

      Raison sociale
      À confirmer (provisoire — DEC-08 / DEC-20)

      Adresse
      À confirmer (provisoire — DEC-08 / DEC-20)

      SIREN
      À confirmer (provisoire — DEC-08 / DEC-20)

      N° d’inscription au registre VTC
      À confirmer (provisoire — DEC-08 / DEC-20)

      Assurance
      À confirmer (provisoire — DEC-08 / DEC-20)

      Téléphone
      À confirmer (provisoire — DEC-08 / DEC-20)

      Email
      À confirmer (provisoire — DEC-08 / DEC-20)"
    `);
  });

  it("renders the English layout", async () => {
    const { html, text } = await renderEmail(layout("en"));
    expect(html).toContain('lang="en"');
    expect(text).toMatchInlineSnapshot(`
      "Avelys

      Template body.

      ----------------------------------------

      Premium private driver in Paris, driven by its two founders.

      You are receiving this email about your Avelys booking.

      Company and contact

      Company name
      To be confirmed (provisional — DEC-08 / DEC-20)

      Address
      To be confirmed (provisional — DEC-08 / DEC-20)

      SIREN
      To be confirmed (provisional — DEC-08 / DEC-20)

      VTC register number
      To be confirmed (provisional — DEC-08 / DEC-20)

      Insurance
      To be confirmed (provisional — DEC-08 / DEC-20)

      Phone
      To be confirmed (provisional — DEC-08 / DEC-20)

      Email
      To be confirmed (provisional — DEC-08 / DEC-20)"
    `);
  });
});
