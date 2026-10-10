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

vi.mock('../ovms/ovmsTransport', () => ({
  createOvmsTransport: (settings: { baseURL?: string }) => {
    TransportCtor(settings)
    return { submit: vi.fn() }
  },
  DEFAULT_OVMS_BASE_URL: 'http://localhost:8000'
}))

import { createOvmsProvider } from '../ovms/ovmsProvider'

describe('createOvmsProvider', () => {
  afterEach(() => {
    ChatCtor.mockReset()
    EmbCtor.mockReset()
    TransportCtor.mockReset()
  })

  it('languageModel uses "ovms.chat" at chat baseURL', () => {
    const provider = createOvmsProvider({ baseURL: 'http://localhost:8000/v3' })
    expect((provider.languageModel('llama') as unknown as { provider: string }).provider).toBe('ovms.chat')

    const [, config] = ChatCtor.mock.calls[0]
    expect(config.url({ path: '/chat/completions', modelId: 'llama' })).toBe(
      'http://localhost:8000/v3/chat/completions'
    )
  })

  it('OVMS omits Authorization (local server, no auth)', () => {
    const provider = createOvmsProvider({ apiKey: 'ignored', baseURL: 'http://localhost:8000/v3' })
    provider.languageModel('llama')
    const headers = ChatCtor.mock.calls[0][1].headers()
    expect(headers.Authorization).toBeUndefined()
  })

  it('embeddingModel uses "ovms.embedding"', () => {
    const provider = createOvmsProvider({ baseURL: 'http://localhost:8000/v3' })
    expect((provider.embeddingModel('e') as unknown as { provider: string }).provider).toBe('ovms.embedding')
  })

  it('imageModel returns an ImageGenerationModel with provider="ovms"', () => {
    const provider = createOvmsProvider({ baseURL: 'http://localhost:8000/v3' })
    expect(provider.imageModel('m').provider).toBe('ovms')
  })

  it('image transport uses imageBaseURL when provided', () => {
    createOvmsProvider({ baseURL: 'http://localhost:8000/v3', imageBaseURL: 'http://localhost:8000' })
    expect(TransportCtor).toHaveBeenCalledWith({ baseURL: 'http://localhost:8000' })
  })

  it('image transport falls back to DEFAULT_OVMS_BASE_URL when imageBaseURL is omitted', () => {
    createOvmsProvider({ baseURL: 'http://localhost:8000/v3' })
    expect(TransportCtor).toHaveBeenCalledWith({ baseURL: 'http://localhost:8000' })
  })
})
