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
    constructor(modelId: string, config: { provider: string; headers: () => Record<string, string> }) {
      EmbCtor(modelId, config)
      this.provider = config.provider
    }
  }
}))

import { registryImageDescriptor } from '../../__tests__/imageCatalogFixtures'
import { buildPpioTransport, createPpioProvider } from '../ppio/ppioProvider'

describe('createPpioProvider', () => {
  afterEach(() => {
    ChatCtor.mockReset()
    EmbCtor.mockReset()
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

  it('requires a prepared binding before exposing an executable image model', () => {
    const provider = createPpioProvider({ apiKey: 'sk-test', baseURL: 'https://api.ppinfra.com/v3/openai' })
    expect(() => provider.imageModel('z-image-turbo')).toThrow('binding')
  })

  it.each([undefined, 'https://proxy.example/ppio'])(
    'uses the image endpoint and provider fetch (%s)',
    async (imageBaseURL) => {
      const requests: Request[] = []
      const descriptor = registryImageDescriptor('ppio', 'qwen-image-txt2img')
      const transport = buildPpioTransport(
        {
          apiKey: 'sk-test',
          baseURL: 'https://api.ppinfra.com/v3/openai',
          imageBaseURL,
          headers: { 'x-provider': 'cherry' },
          fetch: async (url, init) => {
            requests.push(new Request(url, init))
            return Response.json({ task_id: 'accepted' })
          }
        },
        descriptor
      )
      const result = await transport.submit({
        modelId: descriptor.id,
        prompt: 'a fox',
        n: 1,
        size: undefined,
        seed: undefined,
        files: undefined,
        mask: undefined,
        providerParams: {},
        headers: { 'x-call': 'once' }
      })
      // https://ppio.com/docs/models/reference-qwen-image-txt2img — retrieved 2026-09-09.
      expect(requests[0].url).toBe(`${imageBaseURL ?? 'https://api.ppio.com'}/v3/async/qwen-image-txt2img`)
      expect(requests[0].headers.get('authorization')).toBe('Bearer sk-test')
      expect(requests[0].headers.get('x-provider')).toBe('cherry')
      expect(requests[0].headers.get('x-call')).toBe('once')
      expect(result).toEqual({ kind: 'submitted', taskId: 'accepted' })
    }
  )
})
