import type { LanguageModelV3 } from '@ai-sdk/provider'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { APICallError } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RetryFallback } from '../createRetryableWrap'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const { createRetryableWrap } = await import('../createRetryableWrap')

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
    ...overrides
  }
  for (const [key, value] of Object.entries(values)) {
    MockMainPreferenceServiceUtils.setPreferenceValue(key as never, value as never)
  }
}

describe('createRetryableWrap', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
  })

  it('returns undefined when retry is disabled', () => {
    setRetryPreferences({ 'chat.retry.enabled': false })
    expect(createRetryableWrap({ fallbacks: [] })).toBeUndefined()
  })

  it('falls back to the first pre-built fallback when the primary fails non-retryably', async () => {
    setRetryPreferences()
    const fallbackGenerate = vi.fn().mockResolvedValue(okResult)
    const fallbacks: RetryFallback[] = [{ model: makeFakeLanguageModel('claude-x', fallbackGenerate) }]

    const wrap = createRetryableWrap({ fallbacks })
    expect(wrap).toBeDefined()

    const primaryGenerate = vi.fn().mockRejectedValue(makeApiError(401))
    const wrapped = wrap!(makeFakeLanguageModel('gpt-4', primaryGenerate))
    const result = await wrapped.doGenerate({ prompt: [] } as never)

    expect(primaryGenerate).toHaveBeenCalledTimes(1)
    expect(fallbackGenerate).toHaveBeenCalledTimes(1)
    expect(result.content).toEqual(okResult.content)
  })

  it("applies a fallback's per-model option overrides to its call", async () => {
    setRetryPreferences()
    const fallbackGenerate = vi.fn().mockResolvedValue(okResult)
    const fallbacks: RetryFallback[] = [
      {
        model: makeFakeLanguageModel('claude-x', fallbackGenerate),
        options: { temperature: 0.1, maxOutputTokens: 256 }
      }
    ]

    const wrap = createRetryableWrap({ fallbacks })
    const primaryGenerate = vi.fn().mockRejectedValue(makeApiError(401))
    const wrapped = wrap!(makeFakeLanguageModel('gpt-4', primaryGenerate))
    await wrapped.doGenerate({ prompt: [], temperature: 0.9 } as never)

    // ai-retry merges the fallback's options into the call options it replays.
    expect(fallbackGenerate).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0.1, maxOutputTokens: 256 }))
  })

  it('retries the same model on transient errors and emits retry events', async () => {
    vi.useFakeTimers()
    try {
      setRetryPreferences()
      const onRetryEvent = vi.fn()
      const wrap = createRetryableWrap({ fallbacks: [], onRetryEvent })

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

  it('recovers across multiple retries when backoff_enabled is true', async () => {
    vi.useFakeTimers()
    try {
      setRetryPreferences({ 'chat.retry.max_attempts': 3, 'chat.retry.backoff_enabled': true })
      const wrap = createRetryableWrap({ fallbacks: [] })

      const primaryGenerate = vi
        .fn()
        .mockRejectedValueOnce(makeApiError(429))
        .mockRejectedValueOnce(makeApiError(429))
        .mockResolvedValue(okResult)
      const wrapped = wrap!(makeFakeLanguageModel('gpt-4', primaryGenerate))

      const pending = wrapped.doGenerate({ prompt: [] } as never)
      // Advance past the base delay (1s) and the backed-off second delay (2s).
      await vi.advanceTimersByTimeAsync(10_000)
      const result = await pending

      expect(primaryGenerate).toHaveBeenCalledTimes(3)
      expect(result.content).toEqual(okResult.content)
    } finally {
      vi.useRealTimers()
    }
  })
})
