/**
 * Creates the local .env from .env.example (VTC-016): `pnpm env:init`.
 *
 * - Copies .env.example to .env, so every variable of the current template is present.
 * - Generates BETTER_AUTH_SECRET (32 random bytes, base64) when the template leaves it empty.
 * - An existing .env is kept as .env.backup first; values are never printed.
 *
 * Local development only: staging and production get their variables from the platform.
 */
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const TEMPLATE = ".env.example";
const TARGET = ".env";
const BACKUP = ".env.backup";

if (!existsSync(TEMPLATE)) {
  console.error(`${TEMPLATE} introuvable : lancez la commande à la racine du projet.`);
  process.exit(1);
}

if (existsSync(TARGET)) {
  copyFileSync(TARGET, BACKUP);
  console.log(`Ancien ${TARGET} sauvegardé dans ${BACKUP}.`);
}

const secret = randomBytes(32).toString("base64");
const content = readFileSync(TEMPLATE, "utf8").replace(
  /^BETTER_AUTH_SECRET=\s*$/m,
  `BETTER_AUTH_SECRET=${secret}`,
);
writeFileSync(TARGET, content, { encoding: "utf8", mode: 0o600 });

console.log(`${TARGET} créé depuis ${TEMPLATE}, avec un BETTER_AUTH_SECRET généré.`);
console.log("Clés externes (Stripe, Google Maps, Resend) : à renseigner à la main si besoin.");
