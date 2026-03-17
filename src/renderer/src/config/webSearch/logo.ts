import type { CompoundIcon } from '@cherrystudio/ui'
import { Baidu, Bing, Bocha, Exa, Google, Searxng, Tavily, Zhipu } from '@cherrystudio/ui/icons'
import type { WebSearchProviderId } from '@renderer/types'

/**
 * Resolve the CompoundIcon for a given web search provider ID.
 * Centralised here so every UI surface uses the same mapping.
 */
export function getWebSearchProviderLogo(providerId: WebSearchProviderId): CompoundIcon | undefined {
  switch (providerId) {
    case 'zhipu':
      return Zhipu
    case 'tavily':
      return Tavily
    case 'searxng':
      return Searxng
    case 'exa':
    case 'exa-mcp':
      return Exa
    case 'bocha':
      return Bocha
    case 'local-google':
      return Google
    case 'local-bing':
      return Bing
    case 'local-baidu':
      return Baidu
    default:
      return undefined
  }
}
