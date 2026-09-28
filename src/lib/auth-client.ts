import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Browser client for the Better Auth endpoints (same origin, /api/auth). It only carries
 * credentials to the server: every access decision is taken server-side (src/server/auth).
 */
export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});
