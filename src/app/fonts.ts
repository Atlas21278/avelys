import { Bodoni_Moda, Schibsted_Grotesk } from "next/font/google";

// Self-hosted at build time by next/font: no request to Google from the visitor's browser.
export const bodoni = Bodoni_Moda({
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-bodoni",
});

export const schibsted = Schibsted_Grotesk({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-schibsted",
});
