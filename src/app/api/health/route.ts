// Liveness: the process answers. No dependency is checked here, so a database outage
// never makes Kubernetes restart healthy pods (readiness handles that).
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
