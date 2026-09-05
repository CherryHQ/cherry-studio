/**
 * Runtime-neutral local API Gateway route resolution, shared by drivers whose
 * provider policy or wire protocol requires the gateway. Owns the consent →
 * convergence → key sequence.
 */
import { createHash } from 'node:crypto'

import { application } from '@application'
import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { API_GATEWAY_REQUIRED_I18N_KEY } from '@shared/types/apiGateway'
import { gatewayClientOrigin } from '@shared/utils/apiGateway'

/** Whether Agent traffic for this provider must pass through Cherry's local API Gateway. */
export function requiresAgentGateway(providerId: string): boolean {
  return providerId === CHERRY_CLOUD_PROVIDER_ID
}

/**
 * Rotation-sensitive gateway identity for connection signatures: address, key, or state changes
 * rebuild the connection. Read-only by contract — this must never generate or persist a key.
 */
export function gatewayCredentialsFingerprint(): string {
  const apiGatewayService = application.get('ApiGatewayService')
  const config = apiGatewayService.getCurrentConfig()
  const baseUrl = `http://${config.host || '127.0.0.1'}:${config.port || 23333}`
  return createHash('sha256')
    .update(
      JSON.stringify(
        [
          baseUrl,
          typeof config.apiKey === 'string' ? config.apiKey : '',
          `gateway-state:${config.enabled}:${apiGatewayService.isRunning()}`
        ].sort()
      )
    )
    .digest('hex')
}

/**
 * The route needs Cherry's local gateway to bridge the model, but the user keeps the gateway
 * disabled. Raised on the persisted intent only — a gateway that is enabled but not yet listening
 * is a convergence problem, not a consent one, and surfaces its own bind error. `i18nKey` survives
 * `serializeError`, so the turn's error block renders localized copy; the connection driver
 * additionally turns this into a prompt offering to enable it.
 */
export class ApiGatewayNotRunningError extends Error {
  readonly i18nKey = API_GATEWAY_REQUIRED_I18N_KEY
  constructor() {
    super('API Gateway is disabled')
    this.name = 'ApiGatewayNotRunningError'
  }
}

/** Consent, convergence, and key sequence in one place — every gateway route resolves through here. */
export async function resolveApiGatewayRuntime(sessionId: string): Promise<{
  baseUrl: string
  apiKey: string
  usageHeaders: Record<string, string>
  internalRequestToken: string
}> {
  const apiGatewayService = application.get('ApiGatewayService')
  const config = apiGatewayService.getCurrentConfig()
  // Ask for consent on the PERSISTED intent, never on `isRunning()`: the gateway is also briefly
  // down while binding at boot, mid-restart, or after a failed activation, and prompting the user
  // to enable a service they already enabled would be nonsense.
  if (!config.enabled) throw new ApiGatewayNotRunningError()
  // Consent already given, so converging is not an implicit start. `ensureRunning()` goes through
  // the same reconciler (serializing behind an in-flight transition) and throws the real bind
  // error; unlike `start()` it cannot re-persist an intent, so it can never re-enable the gateway.
  await apiGatewayService.ensureRunning()
  // Only after the checks above: this persists a freshly generated key on first use, and a failing
  // route must not leave that side effect behind.
  const apiKey = await apiGatewayService.ensureValidApiKey()
  const runningConfig = apiGatewayService.getCurrentConfig()
  const host = runningConfig.host || '127.0.0.1'
  const port = runningConfig.port || 23333
  return {
    baseUrl: gatewayClientOrigin(host, port),
    apiKey,
    usageHeaders: apiGatewayService.getAgentSessionUsageHeaders(sessionId),
    internalRequestToken: apiGatewayService.getInternalRequestToken()
  }
}
