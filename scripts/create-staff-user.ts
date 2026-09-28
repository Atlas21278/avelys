/**
 * Creates a staff account (VTC-016). Public sign-up is disabled: this local script is the
 * only way to create the first ADMIN, then DISPATCHER or DRIVER accounts.
 *
 *   pnpm auth:create-staff --email ops@example.com --name "Prénom Nom" [--role ADMIN]
 *
 * The password is never an argument (shell history) nor hard-coded: it is typed at a
 * hidden prompt, or read from the first line of stdin when stdin is not a terminal.
 * DATABASE_URL and BETTER_AUTH_SECRET come from .env or the environment. The user enrols
 * TOTP at first sign-in on /admin.
 */
import "dotenv/config";

import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

// Outside Next.js nothing sets NODE_ENV, which the environment schema requires.
(process.env as Record<string, string | undefined>).NODE_ENV ??= "development";

function usage(message: string): never {
  console.error(
    `${message}\nUsage: pnpm auth:create-staff --email <email> --name <name> [--role ADMIN|DISPATCHER|DRIVER]`,
  );
  process.exit(2);
}

function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Mute the echo of typed characters; only the prompt is printed.
    const output = rl as unknown as { _writeToOutput: (text: string) => void };
    output._writeToOutput = (text: string) => {
      if (text.includes(prompt)) process.stdout.write(prompt);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function readFirstLine(): Promise<string> {
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    // Some shells (Windows PowerShell) prefix piped text with a BOM or keep the CR of CRLF.
    return line.replace(/^﻿/, "").replace(/\r$/, "");
  }
  return "";
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) return readFirstLine();
  const password = await readHidden("Mot de passe : ");
  const confirmation = await readHidden("Confirmation : ");
  if (password !== confirmation) usage("Les mots de passe ne correspondent pas.");
  return password;
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string", default: "ADMIN" },
    },
  });
  if (!values.email || !values.name) usage("--email et --name sont obligatoires.");

  const password = await readPassword();

  // Imported after the environment is prepared: the modules validate it on first use.
  const { createStaffUser, StaffUserExistsError } = await import("../src/server/auth/staff-users");
  const { db } = await import("../src/server/db");
  const { ZodError } = await import("zod");

  try {
    const { userId } = await createStaffUser({
      email: values.email,
      name: values.name,
      // Validated by the service schema (ADMIN, DISPATCHER or DRIVER).
      role: values.role as "ADMIN",
      password,
    });
    console.log(
      `Compte ${values.role} créé (id ${userId}). Activer la 2FA à la première connexion sur /admin.`,
    );
  } catch (error) {
    if (error instanceof StaffUserExistsError) usage("Un compte existe déjà avec cet email.");
    if (error instanceof ZodError) {
      // Field names only: the password must never be echoed.
      const fields = [...new Set(error.issues.map((issue) => issue.path.join(".")))].join(", ");
      usage(`Valeurs invalides : ${fields} (mot de passe : 12 caractères minimum).`);
    }
    throw error;
  } finally {
    await db().$disconnect();
  }
}

main().catch((error: unknown) => {
  // Unexpected failure (database, network): no raw message, which could carry connection or
  // query details; the error name and code are enough to diagnose.
  const name = error instanceof Error ? error.name : "UnknownError";
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? ` (${String(error.code)})`
      : "";
  console.error(`Échec de la création du compte : ${name}${code}.`);
  process.exit(1);
});
