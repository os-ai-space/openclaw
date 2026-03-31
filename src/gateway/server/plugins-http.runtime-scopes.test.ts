import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyPluginRegistry } from "../../plugins/registry.js";
import {
  releasePinnedPluginHttpRouteRegistry,
  setActivePluginRegistry,
} from "../../plugins/runtime.js";
import { getPluginRuntimeGatewayRequestScope } from "../../plugins/runtime/gateway-request-scope.js";
import { authorizeOperatorScopesForMethod } from "../method-scopes.js";
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

function assertWriteHelperAllowed() {
  const scopes = getPluginRuntimeGatewayRequestScope()?.client?.connect?.scopes ?? [];
  const auth = authorizeOperatorScopesForMethod("agent", scopes);
  if (!auth.allowed) {
    throw new Error(`missing scope: ${auth.missingScope}`);
  }
}

describe("plugin HTTP route runtime scopes", () => {
  afterEach(() => {
    releasePinnedPluginHttpRouteRegistry();
    setActivePluginRegistry(createEmptyPluginRegistry());
  });

  async function invokeRoute(params: {
    path: string;
    auth: "gateway" | "plugin";
    gatewayAuthSatisfied: boolean;
  }) {
    const log = { warn: vi.fn() } as Parameters<typeof createGatewayPluginRequestHandler>[0]["log"];
    const handler = createGatewayPluginRequestHandler({
      registry: createTestRegistry({
        httpRoutes: [
          createRoute({
            path: params.path,
            auth: params.auth,
            handler: async () => {
              assertWriteHelperAllowed();
              return true;
            },
          }),
        ],
      }),
      log,
    });

    const response = makeMockHttpResponse();
    const handled = await handler(
      { url: params.path } as IncomingMessage,
      response.res,
      undefined,
      { gatewayAuthSatisfied: params.gatewayAuthSatisfied },
    );
    return { handled, log, ...response };
  }

  it("keeps plugin-auth routes off write-capable runtime helpers", async () => {
    const { handled, res, setHeader, end, log } = await invokeRoute({
      path: "/hook",
      auth: "plugin",
      gatewayAuthSatisfied: false,
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(500);
    expect(setHeader).toHaveBeenCalledWith("Content-Type", "text/plain; charset=utf-8");
    expect(end).toHaveBeenCalledWith("Internal Server Error");
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("missing scope: operator.write"));
  });

  it("preserves write-capable runtime helpers on gateway-auth routes", async () => {
    const { handled, res, log } = await invokeRoute({
      path: "/secure-hook",
      auth: "gateway",
      gatewayAuthSatisfied: true,
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(log.warn).not.toHaveBeenCalled();
  });
});
