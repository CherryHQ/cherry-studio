import type { RequestFeature } from '@main/ai/runtime/aiSdk'

// Stand-in for the dev-only AI SDK DevTools feature, which writes its capture store with `node:fs`.
export const devtoolsFeature: RequestFeature = {
  name: 'ai-sdk-devtools',
  applies: () => false
}
