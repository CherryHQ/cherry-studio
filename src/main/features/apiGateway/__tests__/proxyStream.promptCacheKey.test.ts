import { createAnthropic } from '@ai-sdk/anthropic'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamListener } from '@main/ai/streamManager/types'
import { createUniqueModelId, ENDPOINT_TYPE } from '@shared/data/types/model'

/**
 * Pins the gateway boundary contract for issue #18255: authenticated internal
 * Agent requests targeting an OpenAI Responses model must carry a stable,
 * session-derived `promptCacheKey` in the stream call's providerOptions —
 * external requests must not.
 */

const {
  mockStreamPrompt,
  mockGetProvider,
  mockListModels,
  mockGetAgentSessionId,
  mockExtractProviderOptions,
  captured
} = vi.hoisted(() => ({
  mockStreamPrompt: vi.fn(),
  mockGetProvider: vi.fn(),
  mockListModels: vi.fn(),
  mockGetAgentSessionId: vi.fn(),
  mockExtractProviderOptions: vi.fn(),
  captured: {
    opts: undefined as
      | {
          listener?: StreamListener
          callOverrides?: { providerOptions?: ProviderOptions }
          headers?: Record<string, string>
        }
      | undefined
  }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'AiStreamManager') return { streamPrompt: mockStreamPrompt, abort: vi.fn() }
      if (name === 'ApiGatewayService')
        return {
          isInternalRequest: vi.fn(() => mockGetAgentSessionId() !== undefined),
          resolveAgentSessionUsage: vi.fn(() => undefined),
          getAgentSessionId: mockGetAgentSessionId
        }
      return undefined
    })
  }
}))
vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => 'global' }))
vi.mock('@data/services/ProviderService', () => ({
  providerService: { getByProviderId: mockGetProvider }
}))
vi.mock('@data/services/ModelService', () => ({
  modelService: { list: mockListModels }
}))
vi.mock('@logger', () => ({
  loggerService: { withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })) }
}))
vi.mock('../adapters', () => ({
  MessageConverterFactory: {
    create: () => ({
      toUIMessages: () => [],
      toAiSdkTools: () => undefined,
      extractStreamOptions: () => ({}),
      extractProviderOptions: mockExtractProviderOptions
    })
  },
  StreamAdapterFactory: {
    createAdapter: () => ({
      transformChunk: () => [],
      finalizeEvents: () => [],
      buildNonStreamingResponse: () => ({ ok: true })
    }),
    getFormatter: () => ({ formatEvent: () => '', formatDone: () => '' })
  }
}))

import { processMessage } from '../proxyStream'

const PROVIDER_ID = 'my-openai'
const MODEL_ID = 'gpt-5.6'

beforeEach(() => {
  vi.clearAllMocks()
  captured.opts = undefined
  mockGetAgentSessionId.mockReturnValue(undefined)
  mockExtractProviderOptions.mockReturnValue(undefined)
  mockGetProvider.mockReturnValue({
    id: PROVIDER_ID,
    name: PROVIDER_ID,
    isEnabled: true,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://example.invalid/v1', adapterFamily: 'openai' }
    }
  })
  mockListModels.mockReturnValue([
    {
      id: createUniqueModelId(PROVIDER_ID, MODEL_ID),
      providerId: PROVIDER_ID,
      apiModelId: MODEL_ID,
      capabilities: [],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
    }
  ])
  mockStreamPrompt.mockImplementation((opts) => {
    captured.opts = opts
  })
})

async function resolveRequest(stream = false, requestHeaders = new Headers()): Promise<ProviderOptions | undefined> {
  captured.opts = undefined
  const promise = processMessage({
    params: { model: `${PROVIDER_ID}:${MODEL_ID}`, messages: [], stream },
    inputFormat: 'openai',
    outputFormat: 'openai',
    requestHeaders
  })
  await vi.waitFor(() => expect(captured.opts).toBeDefined())
  const providerOptions = captured.opts!.callOverrides?.providerOptions
  void captured.opts!.listener!.onDone({} as any)
  await promise
  return providerOptions
}

describe('processMessage internal Agent prompt cache key', () => {
  it('sends a stable session-derived promptCacheKey for internal Agent requests', async () => {
    mockGetAgentSessionId.mockReturnValue('agent-session-1')

    const first = await resolveRequest()
    const second = await resolveRequest()

    const key = first?.openai?.promptCacheKey
    expect(key).toMatch(/^cherry-agent:[0-9a-f]{32}$/)
    expect(key).not.toContain('agent-session-1')
    expect(second?.openai?.promptCacheKey).toBe(key)
  })

  it('sends distinct keys for distinct Agent sessions', async () => {
    mockGetAgentSessionId.mockReturnValue('agent-session-1')
    const first = await resolveRequest()

    mockGetAgentSessionId.mockReturnValue('agent-session-2')
    const second = await resolveRequest()

    expect(second?.openai?.promptCacheKey).not.toBe(first?.openai?.promptCacheKey)
  })

  it('adds no promptCacheKey for external gateway requests', async () => {
    const providerOptions = await resolveRequest()

    expect(providerOptions?.openai?.promptCacheKey).toBeUndefined()
  })
})

describe('processMessage internal Agent OpenRouter session routing', () => {
  beforeEach(() => {
    mockGetProvider.mockReturnValue({
      id: PROVIDER_ID,
      name: PROVIDER_ID,
      isEnabled: true,
      presetProviderId: 'openrouter',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://openrouter.ai/api/v1',
          adapterFamily: 'openrouter'
        }
      }
    })
    mockListModels.mockReturnValue([
      {
        id: createUniqueModelId(PROVIDER_ID, MODEL_ID),
        providerId: PROVIDER_ID,
        apiModelId: MODEL_ID,
        capabilities: [],
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      }
    ])
  })

  it.each([false, true])('adds stable opaque session_id for authenticated stream=%s requests', async (stream) => {
    mockGetAgentSessionId.mockReturnValue('agent-session-1')

    const first = await resolveRequest(stream)
    const repeated = await resolveRequest(stream)

    const key = first?.openrouter?.session_id
    expect(key).toMatch(/^cherry-agent:[0-9a-f]{32}$/)
    expect(key).not.toContain('agent-session-1')
    expect(repeated?.openrouter?.session_id).toBe(key)
  })

  it('isolates sessions and preserves caller-provided OpenRouter options', async () => {
    mockExtractProviderOptions.mockReturnValue({ openrouter: { reasoning: { effort: 'high' } } })
    mockGetAgentSessionId.mockReturnValue('agent-session-1')
    const first = await resolveRequest()

    mockGetAgentSessionId.mockReturnValue('agent-session-2')
    const second = await resolveRequest()

    expect(first?.openrouter?.reasoning).toEqual({ effort: 'high' })
    expect(second?.openrouter?.session_id).not.toBe(first?.openrouter?.session_id)

    mockExtractProviderOptions.mockReturnValue({ openrouter: { session_id: 'caller-session' } })
    expect((await resolveRequest())?.openrouter?.session_id).toBe('caller-session')
  })

  it.each([
    [false, 'x-session-id', false],
    [true, 'x-session-id', false],
    [false, 'X-Session-Id', false],
    [true, 'X-Session-Id', false],
    [false, 'x-session-id', true],
    [true, 'x-session-id', true],
    [false, 'X-Session-Id', true],
    [true, 'X-Session-Id', true]
  ] as const)(
    'preserves Chat routing overrides: stream=%s provider=%s body=%s',
    async (stream, headerName, explicitBody) => {
      const extraHeaders = { [headerName]: 'provider-chosen' }
      mockGetProvider().settings = { extraHeaders }
      mockGetAgentSessionId.mockReturnValue('agent-session-1')
      mockExtractProviderOptions.mockReturnValue({
        openrouter: { reasoning: { effort: 'high' }, ...(explicitBody ? { session_id: 'caller-session' } : {}) }
      })
      const providerOptions = await resolveRequest(stream)

      let upstreamHeaders: Headers | undefined
      let upstreamBody: Record<string, unknown> | undefined
      const model = createOpenRouter({
        apiKey: 'test-key',
        headers: extraHeaders,
        fetch: async (_url, init) => {
          upstreamHeaders = new Headers(init?.headers)
          upstreamBody = JSON.parse(init?.body as string)
          return stream
            ? new Response('', { headers: { 'content-type': 'text/event-stream' } })
            : Response.json({
                id: 'gen-test',
                created: 1,
                model: MODEL_ID,
                choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
              })
        }
      }).chat(MODEL_ID)
      const options = { prompt: [], providerOptions }
      if (stream) await model.doStream(options)
      else await model.doGenerate(options)

      expect(upstreamHeaders?.get('x-session-id')).toBe('provider-chosen')
      expect(upstreamBody?.session_id).toBe(explicitBody ? 'caller-session' : undefined)
      expect(upstreamBody?.reasoning).toEqual({ effort: 'high' })
    }
  )

  it('adds no session_id for sessionless requests or unrelated providers', async () => {
    expect((await resolveRequest())?.openrouter?.session_id).toBeUndefined()

    mockGetProvider.mockReturnValue({
      id: PROVIDER_ID,
      name: PROVIDER_ID,
      isEnabled: true,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://example.invalid/v1',
          adapterFamily: 'openai-compatible'
        }
      }
    })
    mockGetAgentSessionId.mockReturnValue('agent-session-1')

    expect((await resolveRequest())?.openrouter?.session_id).toBeUndefined()
  })

  it('adds a stable header for OpenRouter Anthropic routes and preserves an explicit value', async () => {
    mockGetProvider.mockReturnValue({
      id: PROVIDER_ID,
      name: PROVIDER_ID,
      isEnabled: true,
      presetProviderId: 'openrouter',
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          baseUrl: 'https://openrouter.ai/api',
          adapterFamily: 'anthropic'
        }
      }
    })
    mockListModels.mockReturnValue([
      {
        id: createUniqueModelId(PROVIDER_ID, MODEL_ID),
        providerId: PROVIDER_ID,
        apiModelId: MODEL_ID,
        capabilities: [],
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      }
    ])
    mockGetAgentSessionId.mockReturnValue('agent-session-1')

    await resolveRequest()
    expect(captured.opts?.headers?.['x-session-id']).toMatch(/^cherry-agent:[0-9a-f]{32}$/)

    captured.opts = undefined
    const requestHeaders = new Headers({ 'x-session-id': 'agent-chosen' })
    const promise = processMessage({
      params: { model: `${PROVIDER_ID}:${MODEL_ID}`, messages: [], stream: false },
      inputFormat: 'openai',
      outputFormat: 'openai',
      requestHeaders
    })
    await vi.waitFor(() => expect(captured.opts).toBeDefined())
    const explicitOptions = captured.opts as { headers?: Record<string, string>; listener?: StreamListener } | undefined
    expect(explicitOptions?.headers).toEqual({ 'x-session-id': 'agent-chosen' })
    void explicitOptions!.listener!.onDone({} as any)
    await promise
  })
  it.each([
    [false, 'x-session-id', false],
    [true, 'x-session-id', false],
    [false, 'X-Session-Id', false],
    [true, 'X-Session-Id', false],
    [false, 'x-session-id', true],
    [true, 'x-session-id', true],
    [false, 'X-Session-Id', true],
    [true, 'X-Session-Id', true]
  ] as const)(
    'preserves session header precedence: stream=%s provider=%s incoming=%s',
    async (stream, headerName, incoming) => {
      const extraHeaders = { [headerName]: 'provider-chosen' }
      const provider = mockGetProvider()
      provider.settings = { extraHeaders }
      provider.endpointConfigs = {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://openrouter.ai/api', adapterFamily: 'anthropic' }
      }
      mockListModels.mockReturnValue([
        {
          id: createUniqueModelId(PROVIDER_ID, MODEL_ID),
          providerId: PROVIDER_ID,
          apiModelId: MODEL_ID,
          capabilities: [],
          endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
        }
      ])
      mockGetAgentSessionId.mockReturnValue('agent-session-1')
      await resolveRequest(stream, new Headers(incoming ? { 'X-Session-ID': 'request-chosen' } : {}))

      let upstreamHeaders: Headers | undefined
      const model = createAnthropic({
        apiKey: 'test-key',
        headers: extraHeaders,
        fetch: async (_url, init) => {
          upstreamHeaders = new Headers(init?.headers)
          return stream
            ? new Response('', { headers: { 'content-type': 'text/event-stream' } })
            : Response.json({
                id: 'msg-test',
                type: 'message',
                role: 'assistant',
                model: MODEL_ID,
                content: [{ type: 'text', text: 'ok' }],
                stop_reason: 'end_turn',
                stop_sequence: null,
                usage: { input_tokens: 1, output_tokens: 1 }
              })
        }
      })(MODEL_ID)
      const options = { prompt: [], maxOutputTokens: 1, headers: captured.opts?.headers }
      if (stream) await model.doStream(options)
      else await model.doGenerate(options)
      expect(upstreamHeaders?.get('x-session-id')).toBe(incoming ? 'request-chosen' : 'provider-chosen')
    }
  )
})
