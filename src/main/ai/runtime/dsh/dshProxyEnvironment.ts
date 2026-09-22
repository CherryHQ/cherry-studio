import { application } from '@application'
import { mergeAgentLoopbackProxyBypass } from '@main/services/proxy/agentProxyEnvironment'
import { getProxyEnvironment } from '@main/services/proxy/proxyEnv'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { gatewayClientOrigin } from '@shared/utils/apiGateway'

import { usesDshGateway } from './modelInjection'

/** Gateway bypass hostname: the gateway is local even on a non-default bind such as 127.0.0.2. */
export function dshGatewayBypassRule(provider: Provider, model: Model): string | undefined {
  if (!usesDshGateway(provider, model)) return undefined
  const config = application.get('ApiGatewayService').getCurrentConfig()
  const host = config.host || '127.0.0.1'
  const port = config.port || 23333
  try {
    return new URL(gatewayClientOrigin(host, port)).hostname
  } catch {
    return undefined
  }
}

/**
 * Exact proxy env materialized for the dsh child: the applied Settings proxy
 * plus loopback defaults plus the actual local-gateway hostname when
 * gateway-routed. Snapshot fingerprint and spawn env share this path so the
 * fingerprinted material and the spread material cannot disagree.
 */
export function buildDshProxyEnvironment(
  provider: Provider,
  model: Model,
  env: NodeJS.ProcessEnv = process.env
): Record<string, string | undefined> {
  const rule = dshGatewayBypassRule(provider, model)
  return mergeAgentLoopbackProxyBypass(
    getProxyEnvironment(env),
    rule === undefined ? {} : { additionalBypassRule: rule }
  )
}
