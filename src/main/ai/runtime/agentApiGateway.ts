/**
 * Runtime-neutral local API Gateway route resolution, shared by drivers whose
 * provider policy or wire protocol requires the gateway. Agent traffic always uses
 * the internal loopback listener, never the user-facing gateway.
 */
import { application } from '@application'
import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { API_GATEWAY_REQUIRED_I18N_KEY } from '@shared/types/apiGateway'

/** Whether Agent traffic for this provider must pass through Cherry's local API Gateway. */
export function requiresAgentGateway(providerId: string): boolean {
  return providerId === CHERRY_CLOUD_PROVIDER_ID
}

/**
 * Gateway identity for connection signatures: a restarted internal listener rebuilds the connection.
 * Read-only by contract — this must never start the listener.
 */
export function gatewayCredentialsFingerprint(): string {
  return `internal-gateway:${application.get('ApiGatewayService').getInternalGatewayOrigin() ?? 'stopped'}`
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

/** Internal gateway route for an Agent session; starts the loopback listener on first use. */
export async function resolveApiGatewayRuntime(sessionId: string): Promise<{
  baseUrl: string
  apiKey: string
  usageHeaders: Record<string, string>
}> {
  const apiGatewayService = application.get('ApiGatewayService')
  const { baseUrl, apiKey } = await apiGatewayService.ensureInternalGateway('agent')
  return { baseUrl, apiKey, usageHeaders: apiGatewayService.getAgentSessionUsageHeaders(sessionId) }
}
