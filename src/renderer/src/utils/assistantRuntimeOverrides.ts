import type { Assistant } from '@renderer/types'

export const buildAssistantRuntimeOverrides = (assistant: Assistant) => ({
  prompt: assistant.prompt,
  settings: {
    ...assistant.settings,
    streamOutput: true
  },
  enableWebSearch: assistant.enableWebSearch ?? false,
  webSearchProviderId: undefined,
  enableUrlContext: assistant.enableUrlContext,
  enableGenerateImage: assistant.enableGenerateImage
})
