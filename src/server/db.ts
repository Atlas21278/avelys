import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { serverEnv } from "@/lib/env/server";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Every session runs in UTC (BR-52). `@prisma/adapter-pg` reads a `timestamptz` by replacing
 * its offset with `+00:00`: under any other session time zone (a managed server defaulting
 * to Europe/Paris, for instance) each instant would be shifted silently. The startup option
 * overrides the server, database and role defaults.
 */
const SESSION_OPTIONS = "-c TimeZone=UTC";

export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString, options: SESSION_OPTIONS });
  return new PrismaClient({ adapter });
}

function createClient(): PrismaClient {
  return createPrismaClient(serverEnv().DATABASE_URL);
}

/**
 * One client per process. In development the instance is kept on globalThis so that
 * hot reload does not open a new connection pool on every edit.
 */
export function db(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}
