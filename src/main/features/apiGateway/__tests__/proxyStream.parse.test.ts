import type { StreamListener } from '@main/ai/streamManager/types'
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
  mockExtractStreamOptions,
  mockExtractProviderOptions,
  captured
} = vi.hoisted(() => ({
  mockStreamPrompt: vi.fn(),
  mockGetProvider: vi.fn(),
  mockListModels: vi.fn(),
  mockExtractStreamOptions: vi.fn(),
  mockExtractProviderOptions: vi.fn(),
  captured: { opts: undefined as { uniqueModelId?: string; listener?: StreamListener } | undefined }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) =>
      name === 'AiStreamManager' ? { streamPrompt: mockStreamPrompt, abort: vi.fn() } : undefined
    )
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
  vi.clearAllMocks()
  captured.opts = undefined
  mockGetProvider.mockImplementation(() => {
    throw new Error('Provider not found')
  })
  mockListModels.mockReturnValue([])
  mockExtractStreamOptions.mockReturnValue({})
  mockExtractProviderOptions.mockReturnValue(undefined)
  mockStreamPrompt.mockImplementation((opts) => {
    captured.opts = opts
  })
})

function mockAvailableModel(providerId: string, internalModelId: string, apiModelId = internalModelId) {
  mockGetProvider.mockReturnValue({ id: providerId, name: providerId, isEnabled: true })
  mockListModels.mockReturnValue([
    {
      id: createUniqueModelId(providerId, internalModelId),
      providerId,
      apiModelId,
      capabilities: []
    }
  ])
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

  it('splits on the first colon for a simple provider:model', async () => {
    mockAvailableModel('openai', 'gpt-4')
    expect(await resolveValid('openai:gpt-4')).toBe(createUniqueModelId('openai', 'gpt-4'))
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
