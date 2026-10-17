import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { ENDPOINT_TYPE, type EndpointType, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { applyAgentPromptCacheKey } from '../utils/promptCacheKey'

function provider(id: string, endpointType: EndpointType, adapterFamily?: string): Provider {
  return {
    id,
    endpointConfigs: {
      [endpointType]: { baseUrl: 'https://example.invalid/v1', ...(adapterFamily ? { adapterFamily } : {}) }
    }
  } as Provider
}

function model(providerId: string, endpointType: EndpointType): Model {
  return {
    id: `${providerId}::gpt-5.6`,
    providerId,
    apiModelId: 'gpt-5.6',
    name: 'gpt-5.6',
    endpointTypes: [endpointType],
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  }
}

const SESSION_ID = '018f2f45-agent-session'

const openaiProvider = provider('my-openai', ENDPOINT_TYPE.OPENAI_RESPONSES, 'openai')
const openaiModel = model('my-openai', ENDPOINT_TYPE.OPENAI_RESPONSES)

describe('applyAgentPromptCacheKey', () => {
  it('derives a stable opaque key for the same session and distinct keys across sessions', () => {
    const first = applyAgentPromptCacheKey(openaiProvider, openaiModel, {}, SESSION_ID)
    const second = applyAgentPromptCacheKey(openaiProvider, openaiModel, {}, SESSION_ID)
    const other = applyAgentPromptCacheKey(openaiProvider, openaiModel, {}, 'another-session')

    const key = first.openai?.promptCacheKey
    expect(key).toMatch(/^cherry-agent:[0-9a-f]{32}$/)
    expect(key).not.toContain(SESSION_ID)
    expect(second.openai?.promptCacheKey).toBe(key)
    expect(other.openai?.promptCacheKey).not.toBe(key)
  })

  it('preserves existing options in the target namespace and other namespaces', () => {
    const result = applyAgentPromptCacheKey(
      openaiProvider,
      openaiModel,
      { openai: { reasoningEffort: 'high' }, other: { keep: true } },
      SESSION_ID
    )

    expect(result.openai?.reasoningEffort).toBe('high')
    expect(result.openai?.promptCacheKey).toBeDefined()
    expect(result.other).toEqual({ keep: true })
  })

  it('never overrides an already-set promptCacheKey', () => {
    const result = applyAgentPromptCacheKey(
      openaiProvider,
      openaiModel,
      { openai: { promptCacheKey: 'own' } },
      SESSION_ID
    )

    expect(result.openai?.promptCacheKey).toBe('own')
  })

  it('leaves non-Responses endpoints untouched', () => {
    const anthropicProvider = provider('my-anthropic', ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'anthropic')
    const anthropicModel = model('my-anthropic', ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    const options = { anthropic: { thinking: { type: 'enabled' } } }

    expect(applyAgentPromptCacheKey(anthropicProvider, anthropicModel, options, SESSION_ID)).toBe(options)
  })

  // Contract tripwire against @ai-sdk/openai: the options object OUR helper
  // produces must reach the wire as `prompt_cache_key`. Catches both a wrong
  // namespace on our side and an SDK upgrade that stops serializing the field.
  it('is serialized as prompt_cache_key on the OpenAI Responses wire', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            id: 'resp_1',
            created_at: 1,
            model: 'gpt-5.6',
            output: [
              {
                type: 'message',
                id: 'msg_1',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'ok', annotations: [] }]
              }
            ],
            usage: { input_tokens: 1, output_tokens: 1 },
            incomplete_details: null,
            service_tier: null
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    )
    const openai = createOpenAI({ apiKey: 'test-key', fetch: fetchMock as unknown as typeof fetch })
    const providerOptions = applyAgentPromptCacheKey(openaiProvider, openaiModel, {}, SESSION_ID)

    await generateText({ model: openai.responses('gpt-5.6'), prompt: 'ping', providerOptions })

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(body.prompt_cache_key).toBe(providerOptions.openai.promptCacheKey)
  })

  describe('chat completions dialect gating', () => {
    const chatProvider = (
      baseUrl: string,
      options?: { dialect?: { promptCacheKey: boolean }; adapterFamily?: string }
    ) =>
      ({
        id: 'my-relay',
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl,
            ...(options?.dialect ? { dialect: options.dialect } : {}),
            ...(options?.adapterFamily ? { adapterFamily: options.adapterFamily } : {})
          }
        }
      }) as Provider
    const chatModel = model('my-relay', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)

    it('leaves chat-completions hosts untouched unless the dialect opts in', () => {
      const options = { 'my-relay': { existing: true } }
      const result = applyAgentPromptCacheKey(chatProvider('https://relay.example/v1'), chatModel, options, SESSION_ID)

      expect(result).toBe(options)
    })

    it('derives the key for chat-completions hosts that opt in via the dialect flag', () => {
      const result = applyAgentPromptCacheKey(
        chatProvider('https://relay.example/v1', { dialect: { promptCacheKey: true } }),
        chatModel,
        {},
        SESSION_ID
      )

      expect(result['my-relay']?.prompt_cache_key).toMatch(/^cherry-agent:[0-9a-f]{32}$/)
    })

    it('derives the key on api.openai.com without a dialect flag', () => {
      const result = applyAgentPromptCacheKey(chatProvider('https://api.openai.com/v1'), chatModel, {}, SESSION_ID)

      expect(result['my-relay']?.prompt_cache_key).toBeDefined()
    })

    it('never overrides an existing snake_case key on the compatible adapter', () => {
      const result = applyAgentPromptCacheKey(
        chatProvider('https://relay.example/v1', { dialect: { promptCacheKey: true } }),
        chatModel,
        { 'my-relay': { prompt_cache_key: 'own' } },
        SESSION_ID
      )

      expect(result['my-relay']?.prompt_cache_key).toBe('own')
    })

    // Contract tripwires: the namespace key OUR helper writes must reach the chat
    // wire as `prompt_cache_key` on BOTH adapters — @ai-sdk/openai maps its
    // `promptCacheKey` option, while openai-compatible only forwards unknown
    // namespace entries verbatim, which is why the helper writes snake_case there.
    const chatResponse = () =>
      new Response(
        JSON.stringify({
          id: 'chatcmpl-1',
          created: 1,
          model: 'gpt-5.6',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )

    it('is serialized as prompt_cache_key on the openai chat-completions wire', async () => {
      const fetchMock = vi.fn<typeof fetch>(async () => chatResponse())
      const openai = createOpenAI({ apiKey: 'test-key', fetch: fetchMock as unknown as typeof fetch })
      const providerOptions = applyAgentPromptCacheKey(
        chatProvider('https://api.openai.com/v1', { adapterFamily: 'openai' }),
        chatModel,
        {},
        SESSION_ID
      )

      await generateText({ model: openai.chat('gpt-5.6'), prompt: 'ping', providerOptions })

      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
      expect(body.prompt_cache_key).toBe(providerOptions.openai?.promptCacheKey)
    })

    it('is serialized as prompt_cache_key on the openai-compatible chat-completions wire', async () => {
      const fetchMock = vi.fn<typeof fetch>(async () => chatResponse())
      const compatible = createOpenAICompatible({
        name: 'my-relay',
        apiKey: 'test-key',
        baseURL: 'https://relay.example/v1',
        fetch: fetchMock
      })
      const providerOptions = applyAgentPromptCacheKey(
        chatProvider('https://relay.example/v1', { dialect: { promptCacheKey: true } }),
        chatModel,
        {},
        SESSION_ID
      )

      await generateText({ model: compatible.chatModel('gpt-5.6'), prompt: 'ping', providerOptions })

      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
      expect(body.prompt_cache_key).toBe(providerOptions['my-relay']?.prompt_cache_key)
    })
  })
})
