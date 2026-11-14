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
    provider.languageModel('qwen-max')

    const [, config] = ChatCtor.mock.calls[0]
    expect(config.url({ path: '/chat/completions', modelId: 'qwen-max' })).toBe(
      'https://www.dmxapi.cn/chat/completions'
    )
    expect(config.headers()).toMatchObject({ Authorization: 'Bearer sk' })
  })
})
