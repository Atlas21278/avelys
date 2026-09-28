import "server-only";

import * as z from "zod";

import { STAFF_ROLES } from "@/domain/auth/access";
import { logger } from "@/lib/logger";
import { db } from "@/server/db";

import { auth, MIN_PASSWORD_LENGTH } from "./auth";

export const createStaffUserInputSchema = z.object({
  email: z.email().transform((email) => email.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  role: z.enum(STAFF_ROLES),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(128),
});

export type CreateStaffUserInput = z.input<typeof createStaffUserInputSchema>;

export class StaffUserExistsError extends Error {
  constructor() {
    super("A user with this email already exists.");
    this.name = "StaffUserExistsError";
  }
}

/**
 * Creates a staff account (email + password) outside of any HTTP request: public sign-up
 * is disabled (VTC-016), so this is the only way in. The password is hashed by Better Auth
 * and never stored or logged in clear. 2FA is enrolled by the user at first sign-in.
 */
export async function createStaffUser(input: CreateStaffUserInput): Promise<{ userId: string }> {
  const data = createStaffUserInputSchema.parse(input);
  const ctx = await auth().$context;

  const existing = await db().user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });
  if (existing) throw new StaffUserExistsError();

  const passwordHash = await ctx.password.hash(data.password);

  // User and credential account are written together: never a user without a password.
  const userId = ctx.generateId({ model: "user" });
  const accountId = ctx.generateId({ model: "account" });
  if (!userId || !accountId) throw new Error("Better Auth did not generate an id.");

  await db().$transaction([
    db().user.create({
      data: {
        id: userId,
        email: data.email,
        name: data.name,
        role: data.role,
        emailVerified: false,
      },
    }),
    db().account.create({
      data: {
        id: accountId,
        userId,
        accountId: userId,
        providerId: "credential",
        password: passwordHash,
      },
    }),
  ]);

  // No email in logs (PII minimisation): the id and the role are enough to trace it.
  logger().info({ userId, role: data.role }, "staff user created");
  return { userId };
}
