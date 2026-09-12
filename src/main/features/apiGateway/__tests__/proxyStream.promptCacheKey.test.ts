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
      | { listener?: StreamListener; callOverrides?: { providerOptions?: Record<string, Record<string, unknown>> } }
      | undefined
  }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'AiStreamManager') return { streamPrompt: mockStreamPrompt, abort: vi.fn() }
      if (name === 'ApiGatewayService')
        return {
          isInternalAgentRequest: vi.fn(() => mockGetAgentSessionId() !== undefined),
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

async function resolveRequest(stream = false): Promise<Record<string, Record<string, unknown>> | undefined> {
  captured.opts = undefined
  const promise = processMessage({
    params: { model: `${PROVIDER_ID}:${MODEL_ID}`, messages: [], stream },
    inputFormat: 'openai',
    outputFormat: 'openai',
    requestHeaders: new Headers()
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
})
