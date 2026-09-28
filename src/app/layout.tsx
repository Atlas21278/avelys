import type { Metadata } from "next";

import { bodoni, schibsted } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Avelys",
  description: "Chauffeur privé premium à Paris",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${bodoni.variable} ${schibsted.variable}`}>
      <body>{children}</body>
    </html>
  );
}
