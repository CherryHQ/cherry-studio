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

vi.mock('../dmxapi/dmxapiTransport', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createDmxapiTransport: (settings: { apiKey: string; baseURL?: string }) => {
      TransportCtor(settings)
      return { submit: vi.fn() }
    }
  }
})

import { createDmxapiProvider } from '../dmxapi/dmxapiProvider'

describe('createDmxapiProvider', () => {
  afterEach(() => {
    ChatCtor.mockReset()
    EmbCtor.mockReset()
    TransportCtor.mockReset()
  })

  it('languageModel uses "dmxapi.chat" with Bearer auth at chat baseURL', () => {
    const provider = createDmxapiProvider({ apiKey: 'sk', baseURL: 'https://www.dmxapi.cn' })
    // A generic (non-OpenAI/Anthropic/Gemini) chat id routes through the
    // OpenAI-compat fallback family, which is the `dmxapi.chat` path.
    expect((provider.languageModel('qwen-max') as unknown as { provider: string }).provider).toBe('dmxapi.chat')

    const [, config] = ChatCtor.mock.calls[0]
    expect(config.url({ path: '/chat/completions', modelId: 'qwen-max' })).toBe(
      'https://www.dmxapi.cn/chat/completions'
    )
    expect(config.headers()).toMatchObject({ Authorization: 'Bearer sk' })
  })

  it('embeddingModel uses "dmxapi.embedding"', () => {
    const provider = createDmxapiProvider({ apiKey: 'sk', baseURL: 'https://www.dmxapi.cn' })
    expect((provider.embeddingModel('e') as unknown as { provider: string }).provider).toBe('dmxapi.embedding')
  })

  it('imageModel returns an ImageGenerationModel with provider="dmxapi"', () => {
    const provider = createDmxapiProvider({ apiKey: 'sk', baseURL: 'https://www.dmxapi.cn' })
    // A bespoke-family model (Doubao Seedream) routes through the custom
    // transport-backed ImageGenerationModel, whose provider is plain "dmxapi".
    expect(provider.imageModel('doubao-seedream-3-0').provider).toBe('dmxapi')
  })

  it('strips the OpenAI-compat suffix from baseURL to derive the transport host', () => {
    createDmxapiProvider({ apiKey: 'sk', baseURL: 'https://www.dmxapi.cn/v1' })
    expect(TransportCtor).toHaveBeenCalledWith({ apiKey: 'sk', baseURL: 'https://www.dmxapi.cn' })
  })

  it('keeps baseURL untouched when no OpenAI-compat suffix is present', () => {
    createDmxapiProvider({ apiKey: 'sk', baseURL: 'https://www.dmxapi.cn' })
    expect(TransportCtor).toHaveBeenCalledWith({ apiKey: 'sk', baseURL: 'https://www.dmxapi.cn' })
  })
})
