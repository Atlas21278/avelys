import { notFound } from "next/navigation";

// Unknown public paths render the localized `[locale]/not-found.tsx` instead of the root one.
export default function CatchAll() {
  notFound();
}
