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
    constructor(modelId: string, config: { provider: string }) {
      EmbCtor(modelId, config)
      this.provider = config.provider
    }
  }
}))

vi.mock('../pollingTransports/tokenflux', () => ({
  createTokenFluxTransport: (settings: { apiKey: string; baseURL?: string }) => {
    TransportCtor(settings)
    return { submit: vi.fn(), poll: vi.fn() }
  },
  DEFAULT_TOKENFLUX_BASE_URL: 'https://api.tokenflux.ai'
}))

import { createTokenFluxProvider } from '../tokenflux-provider'

describe('createTokenFluxProvider', () => {
  afterEach(() => {
    ChatCtor.mockReset()
    EmbCtor.mockReset()
    TransportCtor.mockReset()
  })

  it('languageModel uses "tokenflux.chat" with Bearer auth at chat baseURL', () => {
    const provider = createTokenFluxProvider({ apiKey: 'sk', baseURL: 'https://api.tokenflux.ai/openai/v1' })
    const model = provider.languageModel('flux-llm') as unknown as { provider: string }
    expect(model.provider).toBe('tokenflux.chat')

    const [, config] = ChatCtor.mock.calls[0]
    expect(config.url({ path: '/chat/completions', modelId: 'flux-llm' })).toBe(
      'https://api.tokenflux.ai/openai/v1/chat/completions'
    )
    expect(config.headers()).toMatchObject({ Authorization: 'Bearer sk' })
  })

  it('embeddingModel uses "tokenflux.embedding"', () => {
    const provider = createTokenFluxProvider({ apiKey: 'sk', baseURL: 'https://api.tokenflux.ai/openai/v1' })
    expect((provider.embeddingModel('e') as unknown as { provider: string }).provider).toBe('tokenflux.embedding')
  })

  it('imageModel returns a PollingImageModel with provider="tokenflux"', () => {
    const provider = createTokenFluxProvider({ apiKey: 'sk', baseURL: 'https://api.tokenflux.ai/openai/v1' })
    expect(provider.imageModel('flux-pro').provider).toBe('tokenflux')
  })

  it('polling transport uses imageBaseURL, not chat baseURL', () => {
    createTokenFluxProvider({
      apiKey: 'sk',
      baseURL: 'https://api.tokenflux.ai/openai/v1',
      imageBaseURL: 'https://api.tokenflux.ai'
    })
    expect(TransportCtor).toHaveBeenCalledWith({ apiKey: 'sk', baseURL: 'https://api.tokenflux.ai' })
  })
})
