import { providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'
import { usesBasicAnthropicWebTools } from '@cherrystudio/provider-registry'

import type { RequestFeature } from '../feature'

/** Provider-native URL context (Gemini urlContext / Anthropic web_fetch). */
export const providerUrlContextFeature: RequestFeature = {
  name: 'provider-url-context',
  applies: (scope) => scope.webToolRoutes?.webFetch === 'server',
  contributeModelAdapters: (scope) => [
    providerToolPlugin(
      'urlContext',
      {},
      {
        anthropicWebToolSchema: usesBasicAnthropicWebTools(scope.model?.id ?? '') ? 'basic' : 'dynamic'
      }
    )
  ]
}
