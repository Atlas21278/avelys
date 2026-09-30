import { Body, Container, Head, Hr, Html, Preview, Section, Text } from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";

import type { Locale } from "@/i18n/routing";
import { SITE_IDENTITY_DECISIONS, SITE_IDENTITY_FIELDS, siteIdentity } from "@/lib/site-identity";

import { emailTranslator } from "./i18n";

/**
 * Common layout of every transactional email (VTC-043, ADR-0011), FR/EN. Colours and type follow
 * DESIGN.md with email-safe font fallbacks; styles are inline, as mail clients require.
 *
 * The footer repeats the site identity with its provisional placeholders (DEC-08 / DEC-20). No
 * legal mention and no cancellation or refund condition is written here: they belong to the
 * templates once decided.
 */

const COLORS = {
  ink: "#1f2124",
  paper: "#f4efe6",
  graphite: "#5b5852",
  hairline: "#d6cec0",
  onInkMuted: "#a8a298",
} as const;

const SERIF = "'Bodoni Moda', 'Bodoni 72', Didot, Georgia, serif";
const SANS = "'Schibsted Grotesk', Helvetica, Arial, sans-serif";

const styles = {
  body: { backgroundColor: COLORS.paper, color: COLORS.ink, fontFamily: SANS, margin: 0 },
  container: { maxWidth: "600px", margin: "0 auto", padding: "32px 0 0" },
  wordmark: { fontFamily: SERIF, fontSize: "28px", lineHeight: "32px", margin: "0 24px 24px" },
  content: { padding: "0 24px 24px", fontSize: "16px", lineHeight: "24px" },
  rule: { borderColor: COLORS.hairline, margin: 0 },
  footer: { backgroundColor: COLORS.ink, color: COLORS.paper, padding: "24px" },
  footerText: { fontSize: "14px", lineHeight: "20px", margin: "0 0 12px" },
  footerMuted: { color: COLORS.onInkMuted, fontSize: "13px", lineHeight: "20px", margin: 0 },
  label: {
    color: COLORS.onInkMuted,
    fontSize: "12px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    margin: "16px 0 8px",
  },
  identity: { fontSize: "13px", lineHeight: "18px", margin: "0 0 8px" },
  provisional: { fontStyle: "italic" },
} satisfies Record<string, CSSProperties>;

export interface EmailLayoutProps {
  locale: Locale;
  /** Preview line shown by mail clients next to the subject. */
  preview: string;
  /** Template body. */
  children?: ReactNode;
}

export function EmailLayout({ locale, preview, children }: EmailLayoutProps) {
  const t = emailTranslator(locale);
  const provisional = t("Site.footer.provisional", { decisions: SITE_IDENTITY_DECISIONS });

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.wordmark}>Avelys</Text>
          <Section style={styles.content}>{children}</Section>
          <Hr style={styles.rule} />
          <Section style={styles.footer}>
            <Text style={styles.footerText}>{t("Site.footer.tagline")}</Text>
            <Text style={styles.footerMuted}>{t("Email.layout.notice")}</Text>
            <Text style={styles.label}>{t("Site.footer.identityTitle")}</Text>
            {SITE_IDENTITY_FIELDS.map((field) => {
              const value = siteIdentity[field];
              return (
                <Text key={field} style={styles.identity}>
                  <span style={{ color: COLORS.onInkMuted }}>
                    {t(`Site.footer.identity.${field}`)}
                  </span>
                  <br />
                  <span
                    style={value ? undefined : styles.provisional}
                    data-provisional={value ? undefined : SITE_IDENTITY_DECISIONS}
                  >
                    {value ?? provisional}
                  </span>
                </Text>
              );
            })}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
