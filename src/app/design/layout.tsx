import { bodoni, schibsted } from "../fonts";
import "../globals.css";

// The internal design sheet sits outside the localized site (French only, never indexed).
export default function DesignLayout({ children }: LayoutProps<"/design">) {
  return (
    <html lang="fr" className={`${bodoni.variable} ${schibsted.variable}`}>
      <body>{children}</body>
    </html>
  );
}
