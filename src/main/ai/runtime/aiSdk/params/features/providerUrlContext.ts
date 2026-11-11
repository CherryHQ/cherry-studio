import { providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'
import { usesBasicAnthropicWebTools } from '@cherrystudio/provider-registry'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { getRawModelId } from '@shared/utils/model'

import type { RequestFeature } from '../feature'

/** Provider-native URL context (Gemini urlContext / Anthropic web_fetch). */
export const providerUrlContextFeature: RequestFeature = {
  name: 'provider-url-context',
  applies: (scope) => scope.webToolRoutes?.webFetch === 'server',
  contributeModelAdapters: (scope) => [
    providerToolPlugin(
      'urlContext',
      scope.endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES
        ? {
            [scope.sdkConfig.providerId]: {
              schema: scope.model && usesBasicAnthropicWebTools(getRawModelId(scope.model)) ? 'basic' : 'dynamic'
            }
          }
        : {}
    )
  ]
}
