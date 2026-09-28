import type { Metadata } from "next";

import { Container } from "@/components/ui/container";

import { bodoni, schibsted } from "../fonts";
import "../globals.css";

export const metadata: Metadata = {
  title: "Back-office — Avelys",
  robots: { index: false, follow: false },
};

// Root layout of the back-office: French only, outside the localized site (excluded from the
// next-intl proxy). No access check here: a layout does not re-render on client navigation.
// Every page calls its own guard from src/server/auth/back-office.ts. Each page sets its own
// measure: narrow for sign-in forms, wide for operational lists.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <html lang="fr" className={`${bodoni.variable} ${schibsted.variable}`}>
      <body>
        <main className="min-h-dvh bg-paper py-14 text-ink">
          <Container>{children}</Container>
        </main>
      </body>
    </html>
  );
}
