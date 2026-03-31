import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyPluginRegistry } from "../../plugins/registry.js";
import {
  releasePinnedPluginHttpRouteRegistry,
  setActivePluginRegistry,
} from "../../plugins/runtime.js";
import { getPluginRuntimeGatewayRequestScope } from "../../plugins/runtime/gateway-request-scope.js";
import { makeMockHttpResponse } from "../test-http-response.js";
import { createTestRegistry } from "./__tests__/test-utils.js";
import { createGatewayPluginRequestHandler } from "./plugins-http.js";

function createRoute(params: {
  path: string;
  auth: "gateway" | "plugin";
  handler?: (req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean>;
}) {
  return {
    pluginId: "route",
    path: params.path,
    auth: params.auth,
    match: "exact" as const,
    handler: params.handler ?? (() => true),
    source: "route",
  };
}

describe("plugin HTTP route runtime scopes", () => {
  afterEach(() => {
    releasePinnedPluginHttpRouteRegistry();
    setActivePluginRegistry(createEmptyPluginRegistry());
  });

  it.each([
    {
      auth: "plugin" as const,
      gatewayAuthSatisfied: false,
      expectedScopes: ["operator.read"],
    },
    {
      auth: "gateway" as const,
      gatewayAuthSatisfied: true,
      expectedScopes: ["operator.write"],
    },
  ])(
    "maps $auth routes to $expectedScopes",
    async ({ auth, gatewayAuthSatisfied, expectedScopes }) => {
      let observedScopes: string[] | undefined;
      const handler = createGatewayPluginRequestHandler({
        registry: createTestRegistry({
          httpRoutes: [
            createRoute({
              path: auth === "plugin" ? "/hook" : "/secure-hook",
              auth,
              handler: vi.fn(async () => {
                observedScopes =
                  getPluginRuntimeGatewayRequestScope()?.client?.connect?.scopes?.slice() ?? [];
                return true;
              }),
            }),
          ],
        }),
        log: { warn: vi.fn() } as Parameters<typeof createGatewayPluginRequestHandler>[0]["log"],
      });

      const { res } = makeMockHttpResponse();
      const handled = await handler(
        { url: auth === "plugin" ? "/hook" : "/secure-hook" } as IncomingMessage,
        res,
        undefined,
        { gatewayAuthSatisfied },
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(observedScopes).toEqual(expectedScopes);
    },
  );
});
