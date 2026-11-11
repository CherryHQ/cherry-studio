import { providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'
import { usesBasicAnthropicWebTools } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { getRawModelId } from '@shared/utils/model'

import type { RequestFeature } from '../feature'

/**
 * Provider-native web search (Anthropic web_search_20250305, Gemini grounding,
 * etc.) — distinct from the agentic `web_search` builtin tool. Both share the
 * wire name `web_search`, so request routing guarantees that only one is injected.
 */
export const providerWebSearchFeature: RequestFeature = {
  name: 'provider-web-search',
  applies: (scope) => scope.webToolRoutes?.webSearch === 'server' && Boolean(scope.capabilities?.webSearchPluginConfig),
  contributeModelAdapters: (scope) => {
    const config: NonNullable<Parameters<typeof providerToolPlugin>[1]> = scope.capabilities!.webSearchPluginConfig!
    const providerId = scope.sdkConfig.providerId
    return [
      providerToolPlugin(
        'webSearch',
        scope.endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
          ? {
              ...config,
              [providerId]: {
                ...config[providerId],
                schema: scope.model && usesBasicAnthropicWebTools(getRawModelId(scope.model)) ? 'basic' : 'dynamic'
              }
            }
          : config
      )
    ]
  }
}
