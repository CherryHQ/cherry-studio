/**
 * Runtime-neutral local API Gateway route resolution, shared by every driver
 * whose runtime cannot speak a provider's native wire protocol (claude always,
 * dsh as a fallback). Owns the consent → convergence → key sequence.
 */
import { createHash } from 'node:crypto'

import { application } from '@application'
import { API_GATEWAY_REQUIRED_I18N_KEY } from '@shared/types/apiGateway'

/**
 * Read-only gateway connection identity for route derivation and connection signatures.
 * Read-only by contract — snapshot capture must never generate or persist a key.
 */
export function readApiGatewayConnectionSnapshot(): { baseUrl: string; fingerprint: string } {
  const apiGatewayService = application.get('ApiGatewayService')
  const config = apiGatewayService.getCurrentConfig()
  const gatewayKey = application.get('PreferenceService').get('feature.api_gateway.api_key')
  const baseUrl = `http://${config.host || '127.0.0.1'}:${config.port || 23333}`
  return {
    baseUrl,
    fingerprint: createHash('sha256')
      .update(
        JSON.stringify({
          baseUrl,
          key: typeof gatewayKey === 'string' ? gatewayKey : '',
          state: `gateway-state:${config.enabled}:${apiGatewayService.isRunning()}`
        })
      )
      .digest('hex')
  }
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
export async function resolveApiGatewayRuntime(
  sessionId: string,
  { allowDisabled = false }: { allowDisabled?: boolean } = {}
): Promise<{
  baseUrl: string
  apiKey: string
  connectionFingerprint: string
  usageHeaders: Record<string, string>
  internalRequestToken: string
}> {
  const apiGatewayService = application.get('ApiGatewayService')
  const config = apiGatewayService.getCurrentConfig()
  // Ask for consent on the PERSISTED intent, never on `isRunning()`: the gateway is also briefly
  // down while binding at boot, mid-restart, or after a failed activation, and prompting the user
  // to enable a service they already enabled would be nonsense.
  if (!config.enabled && !allowDisabled) throw new ApiGatewayNotRunningError()
  // Consent already given, so converging is not an implicit start. `ensureRunning()` goes through
  // the same reconciler (serializing behind an in-flight transition) and throws the real bind
  // error; unlike `start()` it cannot re-persist an intent, so it can never re-enable the gateway.
  if (!apiGatewayService.isRunning()) {
    if (allowDisabled) throw new Error('The leased API Gateway is not running')
    await apiGatewayService.ensureRunning()
  }
  // Only after the checks above: this persists a freshly generated key on first use, and a failing
  // route must not leave that side effect behind.
  const apiKey = await apiGatewayService.ensureValidApiKey()
  const connection = readApiGatewayConnectionSnapshot()
  return {
    baseUrl: connection.baseUrl,
    apiKey,
    connectionFingerprint: connection.fingerprint,
    usageHeaders: apiGatewayService.getAgentSessionUsageHeaders(sessionId),
    internalRequestToken: apiGatewayService.getInternalRequestToken()
  }
}

export async function resolveCherryCloudGatewayRuntime(sessionId: string) {
  await application.get('CherryCloudService').ensureAgentGateway()
  return resolveApiGatewayRuntime(sessionId, { allowDisabled: true })
}
