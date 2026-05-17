import { providerToolPlugin } from '@cherrystudio/ai-core/built-in/plugins'

import type { RequestFeature } from '../feature'

/** Provider-native URL context (Gemini). */
export const providerUrlContextFeature: RequestFeature = {
  name: 'provider-url-context',
  applies: (scope) => Boolean(scope.capabilities?.enableUrlContext),
  contributeModelAdapters: () => [providerToolPlugin('urlContext')]
}
