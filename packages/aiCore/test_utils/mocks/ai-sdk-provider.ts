/**
 * Mock for @cherrystudio/ai-sdk-provider
 * This mock is used in tests to avoid importing the actual package
 */

export type CherryInProviderSettings = {
  apiKey?: string
  baseURL?: string
}

export class OpenAICompatibleRerankingModel {
  readonly specificationVersion = 'v3'

  constructor(
    readonly modelId: string,
    private readonly config: {
      provider: string
    }
  ) {}

  get provider(): string {
    return this.config.provider
  }
}

export const createOpenAICompatibleRerankingModel = (
  modelId: string,
  settings: {
    name: string
    baseURL: string
  }
) => new OpenAICompatibleRerankingModel(modelId, { provider: `${settings.name}.rerank` })

// oxlint-disable-next-line no-unused-vars
export const createCherryIn = (_options?: CherryInProviderSettings) => ({
  // oxlint-disable-next-line no-unused-vars
  languageModel: (_modelId: string) => ({
    specificationVersion: 'v3',
    provider: 'cherryin',
    modelId: 'mock-model',
    supportedUrls: {},
    doGenerate: async () => ({ text: 'mock response' }),
    doStream: async () => ({ stream: (async function* () {})() })
  }),
  // oxlint-disable-next-line no-unused-vars
  chat: (_modelId: string) => ({
    specificationVersion: 'v3',
    provider: 'cherryin-chat',
    modelId: 'mock-model',
    supportedUrls: {},
    doGenerate: async () => ({ text: 'mock response' }),
    doStream: async () => ({ stream: (async function* () {})() })
  }),
  // oxlint-disable-next-line no-unused-vars
  textEmbeddingModel: (_modelId: string) => ({
    specificationVersion: 'v3',
    provider: 'cherryin',
    modelId: 'mock-embedding-model'
  }),
  rerankingModel: (modelId: string) => ({
    specificationVersion: 'v3',
    provider: 'cherryin.rerank',
    modelId
  })
})
