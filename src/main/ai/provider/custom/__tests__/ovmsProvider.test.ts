import { afterEach, describe, expect, it, vi } from 'vitest'

const ChatCtor = vi.fn()
const EmbCtor = vi.fn()

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

import { createOvmsProvider } from '../ovms/ovmsProvider'

describe('createOvmsProvider', () => {
  afterEach(() => {
    ChatCtor.mockReset()
    EmbCtor.mockReset()
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
})
