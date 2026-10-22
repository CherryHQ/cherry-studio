import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StreamListener } from '@main/ai/streamManager/types'
import type { CallOverrides } from '@main/ai/types'
import { BaseService } from '@main/core/lifecycle'
import { CHERRY_CLOUD_MODEL_GROUP, CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { createUniqueModelId } from '@shared/data/types/model'

/**
 * Pins the gateway model-id contract: `model` is `providerId:apiModelId`, split on
 * the FIRST `:` (v1 used `::`).
 */

const {
  mockStreamPrompt,
  mockGetProvider,
  mockListModels,
  mockIsInternalRequest,
  mockGetAgentSessionId,
  mockExtractStreamOptions,
  mockExtractProviderOptions,
  captured
} = vi.hoisted(() => ({
  mockStreamPrompt: vi.fn(),
  mockGetProvider: vi.fn(),
  mockListModels: vi.fn(),
  mockIsInternalRequest: vi.fn<(headers: Headers) => boolean>(),
  mockGetAgentSessionId: vi.fn<(headers: Headers) => string | undefined>(),
  mockExtractStreamOptions: vi.fn(),
  mockExtractProviderOptions: vi.fn(),
  captured: {
    opts: undefined as
      | {
          uniqueModelId?: string
          listener?: StreamListener
          contextOwner?: 'cherry' | 'caller'
          callOverrides?: CallOverrides
        }
      | undefined
  }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'AiStreamManager') return { streamPrompt: mockStreamPrompt, abort: vi.fn() }
      if (name === 'ApiGatewayService') {
        return {
          getAgentSessionId: mockGetAgentSessionId,
          resolveAgentSessionUsage: vi.fn(),
          isInternalRequest: mockIsInternalRequest
        }
      }
      return undefined
    })
  }
}))
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
      extractStreamOptions: mockExtractStreamOptions,
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

beforeEach(() => {
  BaseService.resetInstances()
  vi.clearAllMocks()
  captured.opts = undefined
  mockGetProvider.mockImplementation(() => {
    throw new Error('Provider not found')
  })
  mockListModels.mockReturnValue([])
  mockIsInternalRequest.mockReturnValue(false)
  mockGetAgentSessionId.mockReturnValue(undefined)
  mockExtractStreamOptions.mockReturnValue({})
  mockExtractProviderOptions.mockReturnValue(undefined)
  mockStreamPrompt.mockImplementation((opts) => {
    captured.opts = opts
  })
})

function mockAvailableModel(
  providerId: string,
  internalModelId: string,
  apiModelId = internalModelId,
  group?: string,
  maxOutputTokens?: number
) {
  mockGetProvider.mockReturnValue({ id: providerId, name: providerId, isEnabled: true })
  const model = {
    id: createUniqueModelId(providerId, internalModelId),
    providerId,
    apiModelId,
    group,
    maxOutputTokens,
    capabilities: []
  }
  mockListModels.mockReturnValue([model])
}

/** Resolve a valid (non-streaming) request after capturing the streamPrompt args. */
async function resolveValid(model: string): Promise<string | undefined> {
  const promise = processMessage({
    params: { model, messages: [] },
    inputFormat: 'openai',
    outputFormat: 'openai'
  })
  await vi.waitFor(() => expect(captured.opts).toBeDefined())
  const uniqueModelId = captured.opts!.uniqueModelId
  void captured.opts!.listener!.onDone({} as any)
  await promise
  return uniqueModelId
}

describe('processMessage model-id parsing', () => {
  it('rejects a missing model field', async () => {
    await expect(
      processMessage({ params: { messages: [] } as any, inputFormat: 'openai', outputFormat: 'openai' })
    ).rejects.toThrow(/missing a "model"/)
    expect(mockStreamPrompt).not.toHaveBeenCalled()
  })

  it('rejects a non-string model field', async () => {
    await expect(
      processMessage({ params: { model: 123, messages: [] } as any, inputFormat: 'openai', outputFormat: 'openai' })
    ).rejects.toThrow(/missing a "model"/)
  })

  it('rejects a leading-colon model (empty providerId)', async () => {
    await expect(
      processMessage({
        params: { model: ':gpt-4', messages: [] } as any,
        inputFormat: 'openai',
        outputFormat: 'openai'
      })
    ).rejects.toThrow(/Invalid model format/)
    expect(mockStreamPrompt).not.toHaveBeenCalled()
  })

  it('rejects a trailing-colon model (empty modelId)', async () => {
    await expect(
      processMessage({
        params: { model: 'openai:', messages: [] } as any,
        inputFormat: 'openai',
        outputFormat: 'openai'
      })
    ).rejects.toThrow(/Invalid model format/)
  })

  it('rejects a model with no separator', async () => {
    await expect(
      processMessage({ params: { model: 'gpt-4', messages: [] } as any, inputFormat: 'openai', outputFormat: 'openai' })
    ).rejects.toThrow(/Invalid model format/)
  })

  // Addressing mistakes are client errors. gemini-cli's internal utility calls
  // (chat compression / classification) hardcode bare `gemini-*-flash-lite` names
  // that can never carry the gateway prefix — they must surface as 400s, not 500s.
  it('marks an unprefixed model rejection as a 400', async () => {
    await expect(
      processMessage({
        modelString: 'gemini-3.1-flash-lite',
        params: { contents: [] } as any,
        inputFormat: 'gemini',
        outputFormat: 'gemini'
      })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Invalid model format/) })
    expect(mockStreamPrompt).not.toHaveBeenCalled()
  })

  it('rejects the managed CherryAI default model', async () => {
    await expect(
      processMessage({
        params: { model: 'cherryai:qwen', messages: [] } as any,
        inputFormat: 'openai',
        outputFormat: 'openai'
      })
    ).rejects.toThrow(/not available through the API gateway/)
    expect(mockStreamPrompt).not.toHaveBeenCalled()
  })

  it('splits on the first colon for a simple provider:model', async () => {
    mockAvailableModel('openai', 'gpt-4')
    expect(await resolveValid('openai:gpt-4')).toBe(createUniqueModelId('openai', 'gpt-4'))
  })

  it('marks non-streaming requests as caller-owned', async () => {
    mockAvailableModel('openai', 'gpt-4')
    await resolveValid('openai:gpt-4')
    expect(captured.opts?.contextOwner).toBe('caller')
  })

  it.each([
    [253_407, 98_304, 98_304],
    [8_192, 98_304, 8_192],
    [253_407, undefined, 253_407],
    [undefined, 98_304, undefined]
  ])('respects the served model output ceiling (requested %s, ceiling %s)', async (requested, ceiling, expected) => {
    mockAvailableModel('openai', 'gpt-4', 'gpt-4', undefined, ceiling)
    mockExtractStreamOptions.mockReturnValue({ maxOutputTokens: requested })
    mockExtractProviderOptions.mockImplementation((_provider, _model, _params, maxOutputTokens) => ({
      test: { budget: maxOutputTokens }
    }))

    await resolveValid('openai:gpt-4')

    expect(captured.opts?.callOverrides).toMatchObject({
      maxOutputTokens: expected,
      providerOptions: { test: { budget: expected } }
    })
  })

  it('keeps later colons in the model id (split on FIRST colon only)', async () => {
    mockAvailableModel('openrouter', 'anthropic/claude:beta')
    expect(await resolveValid('openrouter:anthropic/claude:beta')).toBe(
      createUniqueModelId('openrouter', 'anthropic/claude:beta')
    )
  })

  it('uses the explicit modelString override (Gemini path) when the body carries no model', async () => {
    mockAvailableModel('deepseek', 'agent/deepseek-v4-flash')
    const promise = processMessage({
      // Gemini bodies have no `model`; the route passes it in from the URL path.
      params: { contents: [] },
      modelString: 'deepseek:agent/deepseek-v4-flash',
      inputFormat: 'gemini',
      outputFormat: 'gemini'
    })
    await vi.waitFor(() => expect(captured.opts).toBeDefined())
    expect(captured.opts!.uniqueModelId).toBe(createUniqueModelId('deepseek', 'agent/deepseek-v4-flash'))
    void captured.opts!.listener!.onDone({} as any)
    await promise
  })

  it('resolves an external apiModelId to the internal model id', async () => {
    mockAvailableModel('sophnet', 'deepseek-v3', 'DeepSeek-v3')

    expect(await resolveValid('sophnet:DeepSeek-v3')).toBe(createUniqueModelId('sophnet', 'deepseek-v3'))
  })

  it('rejects a Cherry Cloud model from external requests', async () => {
    mockAvailableModel(CHERRY_CLOUD_PROVIDER_ID, 'deepseek-free', 'deepseek-free', CHERRY_CLOUD_MODEL_GROUP)

    await expect(
      processMessage({
        params: { model: `${CHERRY_CLOUD_PROVIDER_ID}:deepseek-free`, messages: [] },
        inputFormat: 'anthropic',
        outputFormat: 'anthropic'
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(mockStreamPrompt).not.toHaveBeenCalled()
  })

  it('routes Cherry Cloud messages for an internal request and attributes Agent session usage', async () => {
    mockAvailableModel(CHERRY_CLOUD_PROVIDER_ID, 'deepseek-free', 'deepseek-free', CHERRY_CLOUD_MODEL_GROUP)
    mockIsInternalRequest.mockReturnValue(true)
    mockGetAgentSessionId.mockReturnValue('session-1')
    const responsePromise = processMessage({
      params: {
        model: `${CHERRY_CLOUD_PROVIDER_ID}:deepseek-free`,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }]
      },
      inputFormat: 'anthropic',
      outputFormat: 'anthropic',
      requestHeaders: new Headers()
    })

    await vi.waitFor(() => expect(captured.opts).toBeDefined())
    expect(captured.opts?.uniqueModelId).toBe(createUniqueModelId(CHERRY_CLOUD_PROVIDER_ID, 'deepseek-free'))
    expect(captured.opts).toMatchObject({ tokenUsageSource: 'agent' })
    void captured.opts!.listener!.onDone({} as any)

    await expect(responsePromise.then((response) => response.json())).resolves.toEqual({ ok: true })
  })

  it('rejects an address that does not match an enabled gateway model', async () => {
    mockStreamPrompt.mockImplementationOnce((opts) => {
      captured.opts = opts
      void opts.listener?.onDone({} as any)
    })

    await expect(
      processMessage({
        params: { model: 'corp:west:gpt-4', messages: [] } as any,
        inputFormat: 'openai',
        outputFormat: 'openai'
      })
    ).rejects.toThrow(/not available through the API gateway/)
    expect(mockStreamPrompt).not.toHaveBeenCalled()
  })
})

describe('internal requests without an Agent session', () => {
  it('serves a Cherry Cloud model without Agent usage attribution', async () => {
    mockAvailableModel(CHERRY_CLOUD_PROVIDER_ID, 'translation-model', 'translation-model', CHERRY_CLOUD_MODEL_GROUP)
    mockIsInternalRequest.mockReturnValue(true)
    const responsePromise = processMessage({
      params: {
        model: `${CHERRY_CLOUD_PROVIDER_ID}:translation-model`,
        messages: [{ role: 'user', content: 'translate' }]
      },
      inputFormat: 'openai',
      outputFormat: 'openai',
      requestHeaders: new Headers()
    })
    await vi.waitFor(() => expect(captured.opts).toBeDefined())
    expect(captured.opts?.uniqueModelId).toBe(createUniqueModelId(CHERRY_CLOUD_PROVIDER_ID, 'translation-model'))
    expect(captured.opts).not.toHaveProperty('tokenUsageSource', 'agent')
    void captured.opts!.listener!.onDone({} as any)
    await expect(responsePromise.then((response) => response.json())).resolves.toEqual({ ok: true })
  })
})
