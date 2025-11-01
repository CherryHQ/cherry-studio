import { CLAUDE_SUPPORTED_PROVIDERS } from '@renderer/pages/code'
import type { Provider } from '@renderer/types'

export const getClaudeSupportedProviders = (providers: Provider[]) => {
  return providers.filter((p) => p.type === 'anthropic' || CLAUDE_SUPPORTED_PROVIDERS.includes(p.id))
}
