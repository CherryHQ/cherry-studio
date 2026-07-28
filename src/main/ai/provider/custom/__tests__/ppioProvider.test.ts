import { afterEach, describe, expect, it, vi } from 'vitest'

const ChatCtor = vi.fn()
const EmbCtor = vi.fn()
const TransportCtor = vi.fn()

vi.mock('@ai-sdk/openai-compatible', () => ({
  OpenAICompatibleChatLanguageModel: class {
    provider: string
    constructor(modelId: string, config: { provider: string; headers: () => Record<string, string> }) {
      ChatCtor(modelId, config)
      this.provider = config.provider
    }
  },
  OpenAICompatibleEmbeddingModel: class {
    provider: string
    constructor(modelId: string, config: { provider: string; headers: () => Record<string, string> }) {
      EmbCtor(modelId, config)
      this.provider = config.provider
    }
  }
}))

vi.mock('../ppio/ppioTransport', () => ({
  createPpioTransport: (settings: { apiKey: string; baseURL?: string }) => {
    TransportCtor(settings)
    return { submit: vi.fn(), poll: vi.fn() }
  },
  DEFAULT_PPIO_BASE_URL: 'https://api.ppio.com'
}))

import { createPpioProvider } from '../ppio/ppioProvider'

describe('createPpioProvider', () => {
  afterEach(() => {
    ChatCtor.mockReset()
    EmbCtor.mockReset()
    TransportCtor.mockReset()
  })

  it('languageModel uses provider key "ppio.chat" with Bearer auth at chat baseURL', () => {
    const provider = createPpioProvider({ apiKey: 'sk-test', baseURL: 'https://api.ppinfra.com/v3/openai' })
    const model = provider.languageModel('llama-3') as unknown as { provider: string }
    expect(model.provider).toBe('ppio.chat')

    const [modelId, config] = ChatCtor.mock.calls[0]
    expect(modelId).toBe('llama-3')
    expect(config.url({ path: '/chat/completions', modelId: 'llama-3' })).toBe(
      'https://api.ppinfra.com/v3/openai/chat/completions'
    )
    expect(config.headers()).toMatchObject({ Authorization: 'Bearer sk-test' })
  })

  it('embeddingModel uses provider key "ppio.embedding"', () => {
    const provider = createPpioProvider({ apiKey: 'sk-test', baseURL: 'https://api.ppinfra.com/v3/openai' })
    const model = provider.embeddingModel('text-embed') as unknown as { provider: string }
    expect(model.provider).toBe('ppio.embedding')
  })

  it('imageModel still returns an ImageGenerationModel with provider="ppio" (painting regression guard)', () => {
    const provider = createPpioProvider({ apiKey: 'sk-test', baseURL: 'https://api.ppinfra.com/v3/openai' })
    const img = provider.imageModel('z-image-turbo')
    expect(img.provider).toBe('ppio')
    expect(img.specificationVersion).toBe('v3')
  })

  it('image transport is built from imageBaseURL, NOT chat baseURL', () => {
    createPpioProvider({
      apiKey: 'sk-test',
      baseURL: 'https://api.ppinfra.com/v3/openai',
      imageBaseURL: 'https://api.ppio.com'
    })
    expect(TransportCtor).toHaveBeenCalledWith({ apiKey: 'sk-test', baseURL: 'https://api.ppio.com' })
  })

  it('image transport falls back to DEFAULT_PPIO_BASE_URL when imageBaseURL is omitted', () => {
    createPpioProvider({ apiKey: 'sk-test', baseURL: 'https://api.ppinfra.com/v3/openai' })
    expect(TransportCtor).toHaveBeenCalledWith({ apiKey: 'sk-test', baseURL: 'https://api.ppio.com' })
  })
})
