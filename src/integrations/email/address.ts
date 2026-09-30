import { z } from "zod";

/**
 * Sender address check (VTC-043). Pure, without I/O: shared by the environment schema and the
 * Resend adapter. Accepts `address` or `Display Name <address>`, the two forms Resend takes.
 */

const Address = z.email();

/** `Name <address>`: a non-empty name without angle brackets, then the address. */
const NAMED = /^([^<>]*[^<>\s])\s*<([^<>\s]+)>$/;

export function isEmailSender(value: string): boolean {
  if (value !== value.trim() || value === "") return false;
  const named = NAMED.exec(value);
  const address = named ? named[2] : value;
  return Address.safeParse(address).success;
}
