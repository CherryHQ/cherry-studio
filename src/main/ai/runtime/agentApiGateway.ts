/**
 * Runtime-neutral local API Gateway route resolution for Cherry-managed models. Agent traffic uses
 * the internal loopback listener, never the user-facing gateway.
 */
import { application } from '@application'
import { gatewayClientOrigin } from '@shared/utils/apiGateway'

import type { CliGatewayRoute } from './cli/cliGatewayRoute'

/**
 * Gateway identity for connection signatures: a restarted internal listener rebuilds the connection.
 * Read-only by contract — this must never start the listener.
 */
export function gatewayCredentialsFingerprint(): string {
  return `internal-gateway:${application.get('ApiGatewayService').getInternalGatewayOrigin() ?? 'stopped'}`
}

/** Internal gateway route for an Agent session; starts the loopback listener on first use. */
export async function resolveApiGatewayRuntime(sessionId: string): Promise<{
  baseUrl: string
  apiKey: string
  usageHeaders: Record<string, string>
}> {
  const apiGatewayService = application.get('ApiGatewayService')
  const { baseUrl, apiKey } = await apiGatewayService.ensureInternalGateway(sessionId)
  return { baseUrl, apiKey, usageHeaders: apiGatewayService.getAgentSessionUsageHeaders(sessionId) }
}

export async function bindCliGatewayRoute(
  sessionId: string,
  route: CliGatewayRoute | undefined
): Promise<{ dispose(): void } | undefined> {
  if (!route) return undefined
  const gateway = application.get('ApiGatewayService')
  const current = gateway.getCurrentConfig()
  if (
    !current.apiKey ||
    route.apiKey !== current.apiKey ||
    URL.parse(route.baseUrl)?.origin !== gatewayClientOrigin(current.host, current.port)
  )
    return undefined

  const lease = await gateway.createScopedCredential({
    path: route.path,
    model: route.model,
    agentSessionId: sessionId
  })
  try {
    route.install(lease)
    return lease
  } catch (error) {
    lease.dispose()
    throw error
  }
}
