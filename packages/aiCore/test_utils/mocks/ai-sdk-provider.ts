/**
 * Mock for @cherrystudio/ai-sdk-provider
 * This mock is used in tests to avoid importing the actual package
 */

export type CherryInProviderSettings = {
  apiKey?: string
  baseURL?: string
}

// oxlint-disable-next-line no-unused-vars
export const createCherryIn = (_options?: CherryInProviderSettings) => ({
  // oxlint-disable-next-line no-unused-vars
  languageModel: (_modelId: string) => ({
    specificationVersion: 'v1',
    provider: 'cherryin',
    modelId: 'mock-model',
    doGenerate: async () => ({ text: 'mock response' }),
    doStream: async () => ({ stream: (async function* () {})() })
  }),
  // oxlint-disable-next-line no-unused-vars
  chat: (_modelId: string) => ({
    specificationVersion: 'v1',
    provider: 'cherryin-chat',
    modelId: 'mock-model',
    doGenerate: async () => ({ text: 'mock response' }),
    doStream: async () => ({ stream: (async function* () {})() })
  }),
  // oxlint-disable-next-line no-unused-vars
  textEmbeddingModel: (_modelId: string) => ({
    specificationVersion: 'v1',
    provider: 'cherryin',
    modelId: 'mock-embedding-model'
  })
})
