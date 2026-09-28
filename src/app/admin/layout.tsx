import type { Metadata } from "next";

import { Container } from "@/components/ui/container";

export const metadata: Metadata = {
  title: "Back-office — Avelys",
  robots: { index: false, follow: false },
};

// No access check here: a layout does not re-render on client navigation. Every page
// calls its own guard from src/server/auth/back-office.ts.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <main className="min-h-dvh bg-paper py-14 text-ink">
      <Container className="max-w-md">{children}</Container>
    </main>
  );
}
