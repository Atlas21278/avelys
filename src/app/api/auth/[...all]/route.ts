import { auth } from "@/server/auth/auth";

export const dynamic = "force-dynamic";

// Better Auth endpoints (sign-in, sign-out, session, two-factor), rate limited by Better Auth.
// The instance is resolved per request so that `next build` needs no runtime variables.
function handle(request: Request): Promise<Response> {
  return auth().handler(request);
}

export { handle as GET, handle as POST };
