import { providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'

import type { RequestFeature } from '../feature'

/**
 * Provider-native web search (Anthropic web_search_20250305, Gemini grounding,
 * etc.) — distinct from the agentic `web__search` builtin tool.
 */
export const providerWebSearchFeature: RequestFeature = {
  name: 'provider-web-search',
  applies: (scope) => Boolean(scope.capabilities?.enableWebSearch && scope.capabilities?.webSearchPluginConfig),
  contributeModelAdapters: (scope) => [providerToolPlugin('webSearch', scope.capabilities!.webSearchPluginConfig)]
}
