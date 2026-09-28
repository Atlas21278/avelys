import type messages from "./messages/fr.json";
import type { routing } from "./routing";

// Type-safe locales and message keys: French is the reference catalogue, and
// messages.test.ts checks that English has exactly the same keys.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
