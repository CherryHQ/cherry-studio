import type { EmbeddingModelV3, LanguageModelV3 } from '@ai-sdk/provider'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { APICallError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel, makeProvider } from '../../../../__tests__/fixtures'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const getByProviderId = vi.fn()
const getByKey = vi.fn()
vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getByProviderId: (...args: unknown[]) => getByProviderId(...args) }
}))
vi.mock('@main/data/services/ModelService', () => ({
  modelService: { getByKey: (...args: unknown[]) => getByKey(...args) }
}))

const providerToAiSdkConfig = vi.fn()
vi.mock('../../../../provider/config', () => ({
  providerToAiSdkConfig: (...args: unknown[]) => providerToAiSdkConfig(...args)
}))

const resolveLanguageModel = vi.fn()
vi.mock('@cherrystudio/ai-core', () => ({
  resolveLanguageModel: (...args: unknown[]) => resolveLanguageModel(...args)
}))

const { createEmbeddingRetryWrap, createRetryableWrap } = await import('../createRetryableWrap')

function makeApiError(statusCode: number): APICallError {
  return new APICallError({
    message: `http ${statusCode}`,
    url: 'https://api.test/v1',
    requestBodyValues: {},
    statusCode,
    isRetryable: statusCode === 429 || statusCode === 503 || statusCode === 529
  })
}

const okResult = {
  content: [{ type: 'text' as const, text: 'ok' }],
  finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  warnings: []
}

function makeFakeLanguageModel(modelId: string, doGenerate: ReturnType<typeof vi.fn>): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'test',
    modelId,
    supportedUrls: {},
    doGenerate,
    doStream: vi.fn()
  } as unknown as LanguageModelV3
}

function setRetryPreferences(overrides: Partial<Record<string, unknown>> = {}) {
  const values = {
    'chat.retry.enabled': true,
    'chat.retry.max_attempts': 2,
    'chat.retry.backoff_enabled': false,
    'chat.retry.fallback_model_ids': [],
    ...overrides
  }
  for (const [key, value] of Object.entries(values)) {
    MockMainPreferenceServiceUtils.setPreferenceValue(key as never, value as never)
  }
}

describe('createRetryableWrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
  })

  it('returns undefined when retry is disabled', async () => {
    setRetryPreferences({ 'chat.retry.enabled': false })
    const wrap = await createRetryableWrap({ primaryProviderId: 'openai', primaryModelId: 'gpt-4' })
    expect(wrap).toBeUndefined()
  })

  it('skips fallbacks equal to the primary model and unresolvable fallbacks', async () => {
    setRetryPreferences({
      'chat.retry.fallback_model_ids': ['openai::gpt-4', 'gone::deleted-model', 'anthropic::claude-x']
    })

    getByProviderId.mockImplementation(async (providerId: string) => {
      if (providerId === 'gone') throw new Error('provider deleted')
      return makeProvider({ id: providerId })
    })
    getByKey.mockImplementation(async (providerId: string, modelId: string) =>
      makeModel({ id: `${providerId}::${modelId}` as never, apiModelId: modelId })
    )
    providerToAiSdkConfig.mockResolvedValue({ providerId: 'anthropic', providerSettings: {} })
    const fallbackGenerate = vi.fn().mockResolvedValue(okResult)
    resolveLanguageModel.mockResolvedValue(makeFakeLanguageModel('claude-x', fallbackGenerate))

    const wrap = await createRetryableWrap({ primaryProviderId: 'openai', primaryModelId: 'gpt-4' })
    expect(wrap).toBeDefined()
    // primary skipped, 'gone' unresolvable → only claude-x resolved
    expect(resolveLanguageModel).toHaveBeenCalledTimes(1)

    // primary fails non-retryably → falls back to claude-x
    const primaryGenerate = vi.fn().mockRejectedValue(makeApiError(401))
    const wrapped = wrap!(makeFakeLanguageModel('gpt-4', primaryGenerate))
    const result = await wrapped.doGenerate({ prompt: [] } as never)

    expect(primaryGenerate).toHaveBeenCalledTimes(1)
    expect(fallbackGenerate).toHaveBeenCalledTimes(1)
    expect(result.content).toEqual(okResult.content)
  })

  it('retries the same model on transient errors and emits retry events', async () => {
    vi.useFakeTimers()
    try {
      setRetryPreferences()
      const onRetryEvent = vi.fn()
      const wrap = await createRetryableWrap({
        primaryProviderId: 'openai',
        primaryModelId: 'gpt-4',
        onRetryEvent
      })

      const primaryGenerate = vi.fn().mockRejectedValueOnce(makeApiError(429)).mockResolvedValue(okResult)
      const wrapped = wrap!(makeFakeLanguageModel('gpt-4', primaryGenerate))

      const pending = wrapped.doGenerate({ prompt: [] } as never)
      await vi.advanceTimersByTimeAsync(2_000)
      const result = await pending

      expect(primaryGenerate).toHaveBeenCalledTimes(2)
      expect(result.content).toEqual(okResult.content)
      expect(onRetryEvent).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'gpt-4', reason: 'http 429' }))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('createEmbeddingRetryWrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
  })

  it('returns undefined when retry is disabled', () => {
    setRetryPreferences({ 'chat.retry.enabled': false })
    expect(createEmbeddingRetryWrap()).toBeUndefined()
  })

  it('retries the same embedding model on 429 without switching models', async () => {
    vi.useFakeTimers()
    try {
      setRetryPreferences()
      const doEmbed = vi
        .fn()
        .mockRejectedValueOnce(makeApiError(429))
        .mockResolvedValue({ embeddings: [[0.1]], usage: { tokens: 1 } })
      const base = {
        specificationVersion: 'v3',
        provider: 'test',
        modelId: 'embed-1',
        maxEmbeddingsPerCall: 10,
        supportsParallelCalls: true,
        doEmbed
      } as unknown as EmbeddingModelV3

      const wrap = createEmbeddingRetryWrap()
      const wrapped = wrap!(base)

      const pending = wrapped.doEmbed({ values: ['a'] } as never)
      await vi.advanceTimersByTimeAsync(2_000)
      const result = await pending

      expect(doEmbed).toHaveBeenCalledTimes(2)
      expect(result.embeddings).toEqual([[0.1]])
    } finally {
      vi.useRealTimers()
    }
  })
})
