import { providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'

import type { RequestFeature } from '../feature'

/** Provider-native URL context (Gemini urlContext / Anthropic web_fetch). */
export const providerUrlContextFeature: RequestFeature = {
  name: 'provider-url-context',
  applies: (scope) => scope.webToolRoutes?.webFetch === 'server',
  contributeModelAdapters: () => [providerToolPlugin('urlContext')]
}
