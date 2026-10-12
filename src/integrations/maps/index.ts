import "server-only";

import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";

import { FakeRoutingProvider } from "./fake-routing";
import { GoogleRoutesProvider } from "./google-routes";
import type { RoutingProvider } from "./routing";

export {
  RoutingError,
  type RouteRequest,
  type RoutingErrorCode,
  type RoutingProvider,
} from "./routing";

let instance: RoutingProvider | undefined;

/**
 * Server routing provider. The key and the logger are resolved on each call, never at import or
 * build time: without `GOOGLE_MAPS_SERVER_API_KEY` the first `computeRoute` fails with a typed
 * `ROUTING_PROVIDER_ERROR` (`reason: "not_configured"`).
 *
 * End-to-end tests (VTC-048) switch to the deterministic fake with `E2E_FAKE_ROUTING=true`, read
 * on each call like the key; the environment schema refuses that switch outside APP_ENV
 * `local`/`ci`, so staging and production always use Google.
 */
export function routingProvider(): RoutingProvider {
  if (instance) return instance;
  const google = new GoogleRoutesProvider({
    apiKey: () => serverEnv().GOOGLE_MAPS_SERVER_API_KEY,
    serviceArea: () => serverEnv().ROUTING_SERVICE_AREA,
    logger: {
      info: (fields, message) => logger().info(fields, message),
      warn: (fields, message) => logger().warn(fields, message),
    },
  });
  const fake = new FakeRoutingProvider();
  instance = {
    computeRoute: (request) => (serverEnv().E2E_FAKE_ROUTING ? fake : google).computeRoute(request),
  };
  return instance;
}
