import type { StreamListener } from '@main/ai/streamManager/types'
import { CHERRY_CLOUD_MODEL_GROUP, CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { createUniqueModelId } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pins the gateway model-id contract: `model` is `providerId:apiModelId`, split on
 * the FIRST `:` (v1 used `::`). See the breaking-changes entry
 * `2026-06-06-api-gateway-model-id-separator.md`.
 */

const {
  mockStreamPrompt,
  mockGetProvider,
  mockListModels,
  mockIsInternalAgentRequest,
  mockExtractStreamOptions,
  mockExtractProviderOptions,
  captured
} = vi.hoisted(() => ({
  mockStreamPrompt: vi.fn(),
  mockGetProvider: vi.fn(),
  mockListModels: vi.fn(),
  mockIsInternalAgentRequest: vi.fn(),
  mockExtractStreamOptions: vi.fn(),
  mockExtractProviderOptions: vi.fn(),
  captured: {
    opts: undefined as
      | { uniqueModelId?: string; listener?: StreamListener; contextOwner?: 'cherry' | 'caller' }
      | undefined
  }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'AiStreamManager') return { streamPrompt: mockStreamPrompt, abort: vi.fn() }
      if (name === 'ApiGatewayService') {
        return {
          getAgentSessionId: vi.fn(),
          resolveAgentSessionUsage: vi.fn(),
          isInternalAgentRequest: mockIsInternalAgentRequest
        }
      }
      return undefined
    })
  }
}))
// cn keeps Cherry Cloud agent-only, which the external-request rejection below relies on.
vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => 'cn' }))
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

import { ApiGatewayService } from '../ApiGatewayService'
import { processMessage } from '../proxyStream'

beforeEach(() => {
  vi.clearAllMocks()
  captured.opts = undefined
  mockGetProvider.mockImplementation(() => {
    throw new Error('Provider not found')
  })
  mockListModels.mockReturnValue([])
  mockIsInternalAgentRequest.mockReturnValue(false)
  mockExtractStreamOptions.mockReturnValue({})
  mockExtractProviderOptions.mockReturnValue(undefined)
  mockStreamPrompt.mockImplementation((opts) => {
    captured.opts = opts
  })
})

function mockAvailableModel(providerId: string, internalModelId: string, apiModelId = internalModelId, group?: string) {
  mockGetProvider.mockReturnValue({ id: providerId, name: providerId, isEnabled: true })
  const model = {
    id: createUniqueModelId(providerId, internalModelId),
    providerId,
    apiModelId,
    group,
    capabilities: []
  }
  mockListModels.mockReturnValue([model])
}

/** Resolve a valid (non-streaming) request after capturing the streamPrompt args. */
async function resolveValid(model: string): Promise<string | undefined> {
  const promise = processMessage({
    params: { model, messages: [] } as any,
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

  it('identifies a disabled local provider and the recovery action before routing', async () => {
    mockGetProvider.mockReturnValue({ id: 'openrouter', name: 'OpenRouter', isEnabled: false })

    await expect(
      processMessage({
        params: { model: 'openrouter:deepseek/deepseek-v4-flash-0731', messages: [] } as any,
        inputFormat: 'anthropic',
        outputFormat: 'anthropic'
      })
    ).rejects.toMatchObject({
      status: 400,
      message:
        'Model "openrouter:deepseek/deepseek-v4-flash-0731" is not available through the API gateway. Check that provider "openrouter" and model "deepseek/deepseek-v4-flash-0731" are enabled and gateway-routable.'
    })
    expect(mockListModels).not.toHaveBeenCalled()
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

  it('passes the normalized max output tokens to provider option extraction', async () => {
    mockAvailableModel('openai', 'gpt-4')
    mockExtractStreamOptions.mockReturnValue({ maxOutputTokens: 1024 })

    await resolveValid('openai:gpt-4')

    expect(mockExtractProviderOptions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'openai' }),
      expect.objectContaining({ apiModelId: 'gpt-4' }),
      expect.objectContaining({ model: 'openai:gpt-4' }),
      1024
    )
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
      params: { contents: [] } as any,
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

  it('does not resolve Cherry Cloud models for external requests', async () => {
    mockAvailableModel(CHERRY_CLOUD_PROVIDER_ID, 'deepseek-free', 'deepseek-free', CHERRY_CLOUD_MODEL_GROUP)

    await expect(
      processMessage({
        params: { model: `${CHERRY_CLOUD_PROVIDER_ID}:deepseek-free`, messages: [] },
        inputFormat: 'anthropic',
        outputFormat: 'anthropic'
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(mockListModels).not.toHaveBeenCalled()
    expect(mockStreamPrompt).not.toHaveBeenCalled()
  })

  it('routes Cherry Cloud messages authorized by the production usage-token gate', async () => {
    mockAvailableModel(CHERRY_CLOUD_PROVIDER_ID, 'deepseek-free', 'deepseek-free', CHERRY_CLOUD_MODEL_GROUP)
    const gatewayService = new ApiGatewayService()
    mockIsInternalAgentRequest.mockImplementation((headers) => gatewayService.isInternalAgentRequest(headers))
    const responsePromise = processMessage({
      params: {
        model: `${CHERRY_CLOUD_PROVIDER_ID}:deepseek-free`,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }]
      },
      inputFormat: 'anthropic',
      outputFormat: 'anthropic',
      requestHeaders: new Headers(gatewayService.getAgentSessionUsageHeaders('session-1'))
    })

    await vi.waitFor(() => expect(captured.opts).toBeDefined())
    expect(captured.opts?.uniqueModelId).toBe(createUniqueModelId(CHERRY_CLOUD_PROVIDER_ID, 'deepseek-free'))
    expect(mockListModels).toHaveBeenCalledWith({ providerId: CHERRY_CLOUD_PROVIDER_ID, enabled: true })
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
