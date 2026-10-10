import { providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'

import type { RequestFeature } from '../feature'

/**
 * Provider-native web search (Anthropic web_search_20250305, Gemini grounding,
 * etc.) — distinct from the agentic `web_search` builtin tool. Both share the
 * wire name `web_search`, so request routing guarantees that only one is injected.
 */
export const providerWebSearchFeature: RequestFeature = {
  name: 'provider-web-search',
  applies: (scope) => scope.webToolRoutes?.webSearch === 'server' && Boolean(scope.capabilities?.webSearchPluginConfig),
  contributeModelAdapters: (scope) => [providerToolPlugin('webSearch', scope.capabilities!.webSearchPluginConfig)]
}
