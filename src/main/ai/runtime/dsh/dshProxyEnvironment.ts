import { application } from '@application'
import { mergeAgentLoopbackProxyBypass } from '@main/services/proxy/agentProxyEnvironment'
import { getProxyEnvironment } from '@main/services/proxy/proxyEnv'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { usesDshGateway } from './modelInjection'

/** Gateway bypass hostname: the gateway is local even on a non-default bind such as 127.0.0.2. */
export function dshGatewayBypassRule(provider: Provider, model: Model): string | undefined {
  const origin = application.get('ApiGatewayService').getInternalGatewayOrigin()
  if (!usesDshGateway(provider, model) || !origin) return undefined
  return new URL(origin).hostname
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
