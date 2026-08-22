import type { ProviderConfig } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildPiProviderInjection, materializePiProviderStream } from './modelInjection'
import { withApiKeyHeaderStream } from './piAnthropicAuth'
import { loadPiAnthropicMessagesApi } from './piSdk'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('withApiKeyHeaderStream', () => {
  it('moves the runtime key to the provider-specific header and suppresses Anthropic defaults', () => {
    const apiStreamSimple = vi.fn<NonNullable<ProviderConfig['streamSimple']>>(() => ({}) as never)
    const config = withApiKeyHeaderStream({} as ProviderConfig, 'api-key', apiStreamSimple)

    config.streamSimple?.({} as never, {} as never, {
      apiKey: 'sk-dots-key',
      headers: { 'x-extra': 'kept' }
    })

    expect(apiStreamSimple).toHaveBeenCalledOnce()
    expect(apiStreamSimple.mock.calls[0][2]).toMatchObject({
      apiKey: 'sk-dots-key',
      headers: {
        'api-key': 'sk-dots-key',
        authorization: null,
        'x-api-key': null,
        'x-extra': 'kept'
      }
    })
  })

  it('sends the final Dots request to /v1/messages with only the documented api-key auth header', async () => {
    let request: Request | undefined
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      request = new Request(input, init)
      return new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', fetch)

    const apiStreamSimple = (await loadPiAnthropicMessagesApi()).streamSimple as NonNullable<
      ProviderConfig['streamSimple']
    >
    const config = withApiKeyHeaderStream({} as ProviderConfig, 'api-key', apiStreamSimple)

    config.streamSimple?.(
      {
        id: 'dots3-note-prev',
        name: 'dots3-note-prev',
        api: 'anthropic-messages',
        provider: 'dots',
        baseUrl: 'https://note3-prev-api.askdiandian.com',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 8_192,
        compat: { forceAdaptiveThinking: true }
      } as never,
      { messages: [{ role: 'user', content: 'hello', timestamp: 0 }] } as never,
      { apiKey: 'sk-dots-key' }
    )

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    expect(request?.url).toBe('https://note3-prev-api.askdiandian.com/v1/messages')
    expect(request?.headers.get('api-key')).toBe('sk-dots-key')
    expect(request?.headers.has('authorization')).toBe(false)
    expect(request?.headers.has('x-api-key')).toBe(false)
    await expect(request?.json()).resolves.toMatchObject({
      model: 'dots3-note-prev',
      messages: [{ role: 'user' }],
      max_tokens: 8_192,
      stream: true
    })
  })

  it('sends a Dots OpenAI-only request with only the documented api-key auth header', async () => {
    let request: Request | undefined
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      request = new Request(input, init)
      return new Response(
        'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":0,"model":"dots3-note-prev","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    })
    vi.stubGlobal('fetch', fetch)

    const injection = buildPiProviderInjection(
      {
        id: 'dots',
        name: 'Dots Studio',
        reportsActualCost: false,
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: {
          'openai-chat-completions': {
            adapterFamily: 'openai-compatible',
            baseUrl: 'https://note3-prev-api.askdiandian.com'
          }
        }
      } as never,
      {
        id: 'dots::dots-3-note-preview',
        providerId: 'dots',
        name: 'Dots3-Note Preview',
        apiModelId: 'dots3-note-prev',
        capabilities: [],
        contextWindow: 128_000,
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false,
        endpointTypes: ['openai-chat-completions']
      } as never,
      'sk-dots-key'
    )

    const { providerConfig, streamSimple } = await materializePiProviderStream(injection)
    const stream = streamSimple(
      {
        ...providerConfig.models?.[0],
        api: providerConfig.api,
        provider: injection.providerName,
        baseUrl: providerConfig.baseUrl
      } as never,
      { messages: [{ role: 'user', content: 'hello', timestamp: 0 }] } as never,
      { apiKey: injection.apiKey }
    )

    await stream.result()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    expect(request?.url).toBe('https://note3-prev-api.askdiandian.com/v1/chat/completions')
    expect(request?.headers.get('api-key')).toBe('sk-dots-key')
    expect(request?.headers.has('authorization')).toBe(false)
    expect(request?.headers.has('x-api-key')).toBe(false)
  })
})
