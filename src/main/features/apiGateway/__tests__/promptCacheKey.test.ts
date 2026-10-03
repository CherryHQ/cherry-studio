import { createOpenAI } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateText, streamText } from 'ai'
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
const openRouterProvider = provider('my-router', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'openrouter')
const openRouterModel = model('my-router', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)

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

  it('derives a stable opaque OpenRouter session_id without overriding explicit options', () => {
    const first = applyAgentPromptCacheKey(openRouterProvider, openRouterModel, {}, SESSION_ID)
    const repeated = applyAgentPromptCacheKey(openRouterProvider, openRouterModel, {}, SESSION_ID)
    const other = applyAgentPromptCacheKey(openRouterProvider, openRouterModel, {}, 'another-session')
    const explicit = applyAgentPromptCacheKey(
      openRouterProvider,
      openRouterModel,
      { openrouter: { session_id: 'caller-session', reasoning: { effort: 'high' } } },
      SESSION_ID
    )

    const key = first.openrouter?.session_id
    expect(key).toMatch(/^cherry-agent:[0-9a-f]{32}$/)
    expect(key).not.toContain(SESSION_ID)
    expect(repeated.openrouter?.session_id).toBe(key)
    expect(other.openrouter?.session_id).not.toBe(key)
    expect(explicit.openrouter).toEqual({ session_id: 'caller-session', reasoning: { effort: 'high' } })
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

  it('is serialized as session_id on the OpenRouter Chat wire', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            id: 'gen-1',
            created: 1,
            model: 'openai/gpt-5.6',
            choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    )
    const openrouter = createOpenRouter({ apiKey: 'test-key', fetch: fetchMock as unknown as typeof fetch })
    const providerOptions = applyAgentPromptCacheKey(openRouterProvider, openRouterModel, {}, SESSION_ID)

    await generateText({ model: openrouter.chat('openai/gpt-5.6'), prompt: 'ping', providerOptions })

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(body.session_id).toBe(providerOptions.openrouter.session_id)
  })

  it('is serialized as session_id on the streaming OpenRouter Chat wire', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          [
            'data: {"id":"gen-1","created":1,"model":"openai/gpt-5.6","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}',
            'data: {"id":"gen-1","created":1,"model":"openai/gpt-5.6","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
            'data: [DONE]',
            ''
          ].join('\n\n'),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
        )
    )
    const openrouter = createOpenRouter({ apiKey: 'test-key', fetch: fetchMock as unknown as typeof fetch })
    const providerOptions = applyAgentPromptCacheKey(openRouterProvider, openRouterModel, {}, SESSION_ID)

    const result = streamText({ model: openrouter.chat('openai/gpt-5.6'), prompt: 'ping', providerOptions })
    await result.text

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(body.session_id).toBe(providerOptions.openrouter.session_id)
  })
})
