/**
 * Mock for @cherrystudio/ai-sdk-provider
 * This mock is used in tests to avoid importing the actual package
 */

export type CherryInProviderSettings = {
  apiKey?: string
  baseURL?: string
}

export const createCherryIn = (_options?: CherryInProviderSettings) => ({
  languageModel: (_modelId: string) => ({
    specificationVersion: 'v1',
    provider: 'cherryin',
    modelId: 'mock-model',
    doGenerate: async () => ({ text: 'mock response' }),
    doStream: async () => ({ stream: (async function* () {})() })
  }),
  chat: (_modelId: string) => ({
    specificationVersion: 'v1',
    provider: 'cherryin-chat',
    modelId: 'mock-model',
    doGenerate: async () => ({ text: 'mock response' }),
    doStream: async () => ({ stream: (async function* () {})() })
  }),
  textEmbeddingModel: (_modelId: string) => ({
    specificationVersion: 'v1',
    provider: 'cherryin',
    modelId: 'mock-embedding-model'
  })
})
