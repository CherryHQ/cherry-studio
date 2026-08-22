/**
 * Runtime-neutral local API Gateway route resolution, shared by every driver
 * whose runtime cannot speak a provider's native wire protocol (claude always,
 * dsh as a fallback). Owns the consent → convergence → key sequence.
 */
import { createHash } from 'node:crypto'

import { application } from '@application'
import { API_GATEWAY_REQUIRED_I18N_KEY } from '@shared/types/apiGateway'
import { gatewayClientOrigin } from '@shared/utils/apiGateway'

/**
 * Gateway state a materialized connection is pinned to. It is part of the credentials fingerprint,
 * so disabling (or losing) the gateway makes the next turn rebuild instead of quietly posting to a
 * closed port. Derived and materialized routes MUST build it the same way or every turn rebuilds.
 */
export function gatewayStateTag(enabled: boolean, running: boolean): string {
  return `gateway-state:${enabled}:${running}`
}

/**
 * Rotation-sensitive gateway identity for connection signatures: address, key, or state changes
 * rebuild the connection. Read-only by contract — this must never generate or persist a key.
 */
export function gatewayCredentialsFingerprint(): string {
  const apiGatewayService = application.get('ApiGatewayService')
  const config = apiGatewayService.getCurrentConfig()
  const gatewayKey = application.get('PreferenceService').get('feature.api_gateway.api_key')
  const baseUrl = `http://${config.host || '127.0.0.1'}:${config.port || 23333}`
  return createHash('sha256')
    .update(
      JSON.stringify(
        [
          baseUrl,
          typeof gatewayKey === 'string' ? gatewayKey : '',
          gatewayStateTag(config.enabled, apiGatewayService.isRunning())
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
  stateTag: string
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
  if (!apiGatewayService.isRunning()) await apiGatewayService.ensureRunning()
  // Only after the checks above: this persists a freshly generated key on first use, and a failing
  // route must not leave that side effect behind.
  const apiKey = await apiGatewayService.ensureValidApiKey()
  const host = config.host || '127.0.0.1'
  const port = config.port || 23333
  return {
    baseUrl: gatewayClientOrigin(host, port),
    apiKey,
    stateTag: gatewayStateTag(config.enabled, apiGatewayService.isRunning()),
    usageHeaders: apiGatewayService.getAgentSessionUsageHeaders(sessionId),
    internalRequestToken: apiGatewayService.getInternalRequestToken()
  }
}
