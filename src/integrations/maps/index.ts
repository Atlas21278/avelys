import "server-only";

import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";

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
 */
export function routingProvider(): RoutingProvider {
  instance ??= new GoogleRoutesProvider({
    apiKey: () => serverEnv().GOOGLE_MAPS_SERVER_API_KEY,
    serviceArea: () => serverEnv().ROUTING_SERVICE_AREA,
    logger: {
      info: (fields, message) => logger().info(fields, message),
      warn: (fields, message) => logger().warn(fields, message),
    },
  });
  return instance;
}
