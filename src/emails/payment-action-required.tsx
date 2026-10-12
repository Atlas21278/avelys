import { Button, Heading, Link, Section, Text } from "@react-email/components";
import { createFormatter } from "next-intl";
import type { CSSProperties } from "react";

import type { Locale } from "@/i18n/routing";
import { PARIS_TIME_ZONE } from "@/lib/dates";

import { emailTranslator } from "./i18n";
import { EmailLayout } from "./layout";

/**
 * Customer email "payment authentication required" (VTC-044, DEC-27), FR/EN.
 *
 * PROVISIONAL transactional text (catalogue `Email.paymentActionRequired`): to be proofread by
 * the partners. On purpose it states **no deadline** (DEC-13), **no cancellation or refund
 * condition** (DEC-05) and no legal mention beyond the layout placeholders (DEC-08 / DEC-20).
 * No address, phone, name or card data: reference, pickup instant, frozen amount and the link.
 *
 * Deterministic for a given deduplication key (docs/architecture/email.md): everything shown
 * comes from the props, read from the booking and the Payment attempt, never from the clock.
 */

const COLORS = {
  ink: "#1f2124",
  paper: "#f4efe6",
  graphite: "#5b5852",
  hairline: "#d6cec0",
} as const;

const styles = {
  heading: { fontSize: "24px", lineHeight: "32px", fontWeight: 600, margin: "0 0 16px" },
  paragraph: { margin: "0 0 16px" },
  label: {
    color: COLORS.graphite,
    fontSize: "12px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    margin: "24px 0 8px",
  },
  summary: { borderTop: `1px solid ${COLORS.hairline}`, margin: "0 0 24px" },
  row: { borderBottom: `1px solid ${COLORS.hairline}`, margin: 0, padding: "8px 0" },
  rowLabel: { color: COLORS.graphite },
  hint: { color: COLORS.graphite, fontSize: "14px" },
  button: {
    backgroundColor: COLORS.ink,
    color: COLORS.paper,
    fontWeight: 600,
    padding: "14px 24px",
    textDecoration: "none",
  },
  fallback: { color: COLORS.graphite, fontSize: "14px", lineHeight: "20px", margin: "24px 0 4px" },
  url: { color: COLORS.ink, fontSize: "14px", lineHeight: "20px", wordBreak: "break-all" },
  link: { color: COLORS.ink, textDecoration: "underline" },
} satisfies Record<string, CSSProperties>;

export interface PaymentActionRequiredEmailProps {
  readonly locale: Locale;
  /** Public booking reference. */
  readonly bookingReference: string;
  readonly pickupAt: Date;
  /** Frozen TTC amount of the Payment, integer cents (BR-10); formatted for display only. */
  readonly amountCents: number;
  /** ISO 4217. */
  readonly currency: string;
  /** Signed regularisation link (VTC-042). Holds a token: never logged. */
  readonly paymentUrl: string;
  /** Absolute URL of the contact page in the same language. */
  readonly contactUrl: string;
}

export function paymentActionRequiredSubject(locale: Locale, bookingReference: string): string {
  return emailTranslator(locale)("Email.paymentActionRequired.subject", {
    reference: bookingReference,
  });
}

export function PaymentActionRequiredEmail(props: PaymentActionRequiredEmailProps) {
  const { locale, bookingReference, pickupAt, amountCents, currency, paymentUrl, contactUrl } =
    props;
  const t = emailTranslator(locale);
  const format = createFormatter({ locale, timeZone: PARIS_TIME_ZONE });

  return (
    <EmailLayout locale={locale} preview={t("Email.paymentActionRequired.preview")}>
      <Heading as="h1" style={styles.heading}>
        {t("Email.paymentActionRequired.title")}
      </Heading>
      <Text style={styles.paragraph}>{t("Email.paymentActionRequired.lead")}</Text>

      <Text style={styles.label}>{t("Email.paymentActionRequired.summaryTitle")}</Text>
      <Section style={styles.summary}>
        <Text style={styles.row}>
          <span style={styles.rowLabel}>{t("Email.paymentActionRequired.reference")}</span>
          <br />
          <strong>{bookingReference}</strong>
        </Text>
        <Text style={styles.row}>
          <span style={styles.rowLabel}>{t("Email.paymentActionRequired.pickup")}</span>
          <br />
          {format.dateTime(pickupAt, {
            dateStyle: "full",
            timeStyle: "short",
            timeZone: PARIS_TIME_ZONE,
          })}{" "}
          <span style={styles.hint}>({t("Email.paymentActionRequired.pickupHint")})</span>
        </Text>
        <Text style={styles.row}>
          <span style={styles.rowLabel}>{t("Email.paymentActionRequired.amount")}</span>
          <br />
          <strong>{format.number(amountCents / 100, { style: "currency", currency })}</strong>
        </Text>
      </Section>

      <Text style={styles.paragraph}>{t("Email.paymentActionRequired.actionText")}</Text>
      <Button href={paymentUrl} style={styles.button}>
        {t("Email.paymentActionRequired.action")}
      </Button>
      <Text style={styles.fallback}>{t("Email.paymentActionRequired.linkFallback")}</Text>
      <Text style={styles.url}>
        <Link href={paymentUrl} style={styles.link}>
          {paymentUrl}
        </Link>
      </Text>

      <Text style={{ ...styles.paragraph, marginTop: "24px" }}>{t("Email.paymentActionRequired.confirmation")}</Text>
      <Text style={styles.paragraph}>
        {t("Email.paymentActionRequired.contact")}{" "}
        <Link href={contactUrl} style={styles.link}>
          {t("Email.paymentActionRequired.contactLink")}
        </Link>
      </Text>
    </EmailLayout>
  );
}
