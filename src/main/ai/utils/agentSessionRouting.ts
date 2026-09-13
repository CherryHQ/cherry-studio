import { createHash } from 'node:crypto'

import type { EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { matchesPreset } from '@shared/utils/provider'
import { SystemProviderIds } from '@shared/utils/systemProviderId'

export function deriveAgentSessionRoutingKey(sessionId: string): string {
  const digest = createHash('sha256').update(sessionId).digest('hex')
  return `cherry-agent:${digest.slice(0, 32)}`
}

export function usesOpenRouterSessionRouting(provider: Provider, endpointType: EndpointType | undefined): boolean {
  return (
    matchesPreset(provider, SystemProviderIds.openrouter) ||
    (endpointType !== undefined &&
      provider.endpointConfigs?.[endpointType]?.adapterFamily === SystemProviderIds.openrouter)
  )
}
