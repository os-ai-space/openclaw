import type { OpenClawConfig } from "../../config/config.js";
import { resolveSecretInputRef } from "../../config/types.secrets.js";
import { trimToUndefined } from "../../gateway/credential-planner.js";
import { GatewaySecretRefUnavailableError } from "../../gateway/credentials.js";
import { resolveConfiguredSecretInputString } from "../../gateway/resolve-configured-secret-input-string.js";

function authModeDisablesToken(mode: string | undefined): boolean {
  return mode === "password" || mode === "none" || mode === "trusted-proxy";
}

export async function resolveGatewayTokenForDriftCheck(params: {
  cfg: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
}): Promise<string | undefined> {
  const mode = params.cfg.gateway?.auth?.mode;
  if (authModeDisablesToken(mode)) {
    return undefined;
  }

  const tokenInput = params.cfg.gateway?.auth?.token;
  const tokenRef = resolveSecretInputRef({
    value: tokenInput,
    defaults: params.cfg.secrets?.defaults,
  }).ref;
  if (!tokenRef) {
    return trimToUndefined(tokenInput);
  }

  const env = params.env ?? process.env;
  const resolved = await resolveConfiguredSecretInputString({
    config: params.cfg,
    env,
    value: tokenInput,
    path: "gateway.auth.token",
    unresolvedReasonStyle: "detailed",
  });
  if (resolved.value) {
    return resolved.value;
  }
  throw new GatewaySecretRefUnavailableError("gateway.auth.token");
}
