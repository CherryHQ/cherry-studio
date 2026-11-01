import type { WebSearchCapability, WebSearchProviderMetadata } from '../types'

export function mergeProviderEndpoints(
  metadata: WebSearchProviderMetadata,
  overrides: Partial<Record<WebSearchCapability, { apiHost?: string }>> = {}
): WebSearchProviderMetadata {
  return {
    ...metadata,
    capabilities: metadata.capabilities.map((capability) => ({
      ...capability,
      defaultApiHost: overrides[capability.capability]?.apiHost?.trim() ?? capability.defaultApiHost
    }))
  }
}
