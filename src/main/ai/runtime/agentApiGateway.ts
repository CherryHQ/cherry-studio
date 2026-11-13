/**
 * Runtime-neutral local API Gateway route resolution for Cherry-managed models. Agent traffic uses
 * the internal loopback listener, never the user-facing gateway.
 */
import { application } from '@application'
import { AGENT_RUNTIME_CAPABILITY_HEADER } from '@main/ai/agentSession/agentRuntimeCapability'

/**
 * Gateway identity for connection signatures: a restarted internal listener rebuilds the connection.
 * Read-only by contract — this must never start the listener.
 */
export function gatewayCredentialsFingerprint(): string {
  return `internal-gateway:${application.get('ApiGatewayService').getInternalGatewayOrigin() ?? 'stopped'}`
}

/** Internal gateway route for an Agent session; starts the loopback listener on first use. */
export async function resolveApiGatewayRuntime(
  sessionId: string,
  runtime: 'claude-code' | 'pi'
): Promise<{
  baseUrl: string
  apiKey: string
  usageHeaders: Record<string, string>
}> {
  const apiGatewayService = application.get('ApiGatewayService')
  const { baseUrl, apiKey } = await apiGatewayService.ensureInternalGateway()
  const usageHeaders = apiGatewayService.getAgentSessionUsageHeaders(sessionId)
  const capability =
    runtime === 'claude-code' ? apiGatewayService.issueRuntimeCapability(sessionId, runtime) : undefined
  if (capability) usageHeaders[AGENT_RUNTIME_CAPABILITY_HEADER] = capability
  return { baseUrl, apiKey, usageHeaders }
}
