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
    provider.languageModel('llama-3')

    const [modelId, config] = ChatCtor.mock.calls[0]
    expect(modelId).toBe('llama-3')
    expect(config.url({ path: '/chat/completions', modelId: 'llama-3' })).toBe(
      'https://api.ppinfra.com/v3/openai/chat/completions'
    )
    expect(config.headers()).toMatchObject({ Authorization: 'Bearer sk-test' })
  })
})
