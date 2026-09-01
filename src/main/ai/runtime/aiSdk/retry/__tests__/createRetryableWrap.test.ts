import type { LanguageModelV3 } from '@ai-sdk/provider'
import { APICallError } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { FallbackResolver, RetryFallback } from '../createRetryableWrap'
import type { RetryPolicy } from '../retryPolicy'

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

function makeFakeLanguageModel(
  modelId: string,
  doGenerate: ReturnType<typeof vi.fn>,
  doStream = vi.fn()
): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'test',
    modelId,
    supportedUrls: {},
    doGenerate,
    doStream
  } as unknown as LanguageModelV3
}

function streamResult(parts: unknown[]) {
  return {
    stream: new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part)
        controller.close()
      }
    })
  }
}

async function collectStream(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const values: unknown[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return values
    values.push(value)
  }
}

/** A lazy fallback resolver that resolves immediately to a pre-built fallback. */
function fallbackOf(model: LanguageModelV3, options?: RetryFallback['options']): FallbackResolver {
  return () => Promise.resolve({ model, options })
}

function policy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    enabled: true,
    maxAttempts: 2,
    backoffEnabled: false,
    fallbackModelIds: [],
    ...overrides
  }
}

describe('createRetryableWrap', () => {
  it('returns undefined when retry is disabled', () => {
    expect(createRetryableWrap({ fallbacks: [], retryPolicy: policy({ enabled: false }) })).toBeUndefined()
  })

  it('falls back to the first fallback when the primary fails non-retryably', async () => {
    const fallbackGenerate = vi.fn().mockResolvedValue(okResult)
    const wrap = createRetryableWrap({
      fallbacks: [fallbackOf(makeFakeLanguageModel('claude-x', fallbackGenerate))],
      retryPolicy: policy()
    })
    expect(wrap).toBeDefined()

    const primaryGenerate = vi.fn().mockRejectedValue(makeApiError(401))
    const wrapped = wrap!(makeFakeLanguageModel('gpt-4', primaryGenerate))
    const result = await wrapped.doGenerate({ prompt: [] })

    expect(primaryGenerate).toHaveBeenCalledTimes(1)
    expect(fallbackGenerate).toHaveBeenCalledTimes(1)
    expect(result.content).toEqual(okResult.content)
  })

  it('resolves fallbacks lazily — never invoked on the happy path', async () => {
    const resolve = vi.fn(fallbackOf(makeFakeLanguageModel('claude-x', vi.fn().mockResolvedValue(okResult))))
    const wrap = createRetryableWrap({ fallbacks: [resolve], retryPolicy: policy() })

    const wrapped = wrap!(makeFakeLanguageModel('gpt-4', vi.fn().mockResolvedValue(okResult)))
    await wrapped.doGenerate({ prompt: [] })

    // Primary succeeded → the fallback resolver was never called.
    expect(resolve).not.toHaveBeenCalled()
  })

  it('tries fallbacks in user order — the second is used when the first also fails', async () => {
    const firstGenerate = vi.fn().mockRejectedValue(makeApiError(400))
    const secondGenerate = vi.fn().mockResolvedValue(okResult)
    const wrap = createRetryableWrap({
      fallbacks: [
        fallbackOf(makeFakeLanguageModel('fallback-1', firstGenerate)),
        fallbackOf(makeFakeLanguageModel('fallback-2', secondGenerate))
      ],
      retryPolicy: policy()
    })

    const primaryGenerate = vi.fn().mockRejectedValue(makeApiError(401))
    const wrapped = wrap!(makeFakeLanguageModel('gpt-4', primaryGenerate))
    const result = await wrapped.doGenerate({ prompt: [] })

    expect(firstGenerate).toHaveBeenCalledTimes(1)
    expect(secondGenerate).toHaveBeenCalledTimes(1)
    expect(result.content).toEqual(okResult.content)
  })

  it("applies a fallback's per-model option overrides to its call", async () => {
    const fallbackGenerate = vi.fn().mockResolvedValue(okResult)
    const wrap = createRetryableWrap({
      fallbacks: [
        fallbackOf(makeFakeLanguageModel('claude-x', fallbackGenerate), { temperature: 0.1, maxOutputTokens: 256 })
      ],
      retryPolicy: policy()
    })

    const primaryGenerate = vi.fn().mockRejectedValue(makeApiError(401))
    const wrapped = wrap!(makeFakeLanguageModel('gpt-4', primaryGenerate))
    await wrapped.doGenerate({ prompt: [], temperature: 0.9 })

    // ai-retry merges the fallback's options into the call options it replays.
    expect(fallbackGenerate).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0.1, maxOutputTokens: 256 }))
  })

  it('performs exactly max_attempts same-model retries (the displayed number)', async () => {
    vi.useFakeTimers()
    try {
      const wrap = createRetryableWrap({ fallbacks: [], retryPolicy: policy({ maxAttempts: 2 }) })
      const primaryGenerate = vi.fn().mockRejectedValue(makeApiError(429))
      const wrapped = wrap!(makeFakeLanguageModel('gpt-4', primaryGenerate))

      const pending = Promise.resolve(wrapped.doGenerate({ prompt: [] })).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(10_000)
      await pending

      // max_attempts = 2 retries → 1 original call + 2 retries = 3 total.
      expect(primaryGenerate).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries the same model on transient errors and emits retry events', async () => {
    vi.useFakeTimers()
    try {
      const onRetryEvent = vi.fn()
      const wrap = createRetryableWrap({ fallbacks: [], onRetryEvent, retryPolicy: policy() })

      const primaryGenerate = vi.fn().mockRejectedValueOnce(makeApiError(429)).mockResolvedValue(okResult)
      const wrapped = wrap!(makeFakeLanguageModel('gpt-4', primaryGenerate))

      const pending = wrapped.doGenerate({ prompt: [] })
      await vi.advanceTimersByTimeAsync(2_000)
      const result = await pending

      expect(primaryGenerate).toHaveBeenCalledTimes(2)
      expect(result.content).toEqual(okResult.content)
      expect(onRetryEvent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ state: 'retrying', modelId: 'gpt-4', attempt: 2, reason: 'http 429: http 429' })
      )
      expect(onRetryEvent).toHaveBeenLastCalledWith({ state: 'settled' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('recovers across multiple retries when backoff_enabled is true', async () => {
    vi.useFakeTimers()
    try {
      const wrap = createRetryableWrap({
        fallbacks: [],
        retryPolicy: policy({ maxAttempts: 3, backoffEnabled: true })
      })

      const primaryGenerate = vi
        .fn()
        .mockRejectedValueOnce(makeApiError(429))
        .mockRejectedValueOnce(makeApiError(429))
        .mockResolvedValue(okResult)
      const wrapped = wrap!(makeFakeLanguageModel('gpt-4', primaryGenerate))

      const pending = wrapped.doGenerate({ prompt: [] })
      await vi.advanceTimersByTimeAsync(0)
      expect(primaryGenerate).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1_999)
      expect(primaryGenerate).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(primaryGenerate).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(3_999)
      expect(primaryGenerate).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      const result = await pending

      expect(primaryGenerate).toHaveBeenCalledTimes(3)
      expect(result.content).toEqual(okResult.content)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries the primary before falling back and reports the fallback model', async () => {
    vi.useFakeTimers()
    try {
      const onRetryEvent = vi.fn()
      const fallbackGenerate = vi.fn().mockResolvedValue(okResult)
      const wrap = createRetryableWrap({
        fallbacks: [fallbackOf(makeFakeLanguageModel('fallback-1', fallbackGenerate))],
        onRetryEvent,
        retryPolicy: policy({ maxAttempts: 1 })
      })
      const primaryGenerate = vi.fn().mockRejectedValue(makeApiError(429))

      const pending = wrap!(makeFakeLanguageModel('primary', primaryGenerate)).doGenerate({ prompt: [] })
      await vi.advanceTimersByTimeAsync(2_000)
      await pending

      expect(primaryGenerate).toHaveBeenCalledTimes(2)
      expect(fallbackGenerate).toHaveBeenCalledTimes(1)
      expect(onRetryEvent).toHaveBeenCalledWith(expect.objectContaining({ state: 'retrying', modelId: 'fallback-1' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('memoizes successful fallback resolution but retries a null resolution', async () => {
    const fallback = makeFakeLanguageModel('fallback', vi.fn().mockRejectedValue(makeApiError(400)))
    const resolveNull = vi.fn().mockResolvedValue(null)
    const resolveFallback = vi.fn().mockResolvedValue({ model: fallback })
    const wrap = createRetryableWrap({
      fallbacks: [resolveNull, resolveFallback],
      retryPolicy: policy()
    })
    const wrapped = wrap!(makeFakeLanguageModel('primary', vi.fn().mockRejectedValue(makeApiError(401))))

    await expect(wrapped.doGenerate({ prompt: [] })).rejects.toThrow()
    await expect(wrapped.doGenerate({ prompt: [] })).rejects.toThrow()

    expect(resolveNull.mock.calls.length).toBeGreaterThan(1)
    expect(resolveFallback).toHaveBeenCalledTimes(1)
  })

  it('surfaces the primary error when every fallback resolves to null', async () => {
    const primaryError = makeApiError(401)
    const first = vi.fn().mockResolvedValue(null)
    const second = vi.fn().mockResolvedValue(null)
    const wrap = createRetryableWrap({
      fallbacks: [first, second],
      retryPolicy: policy()
    })
    const wrapped = wrap!(makeFakeLanguageModel('primary', vi.fn().mockRejectedValue(primaryError)))

    await expect(wrapped.doGenerate({ prompt: [] })).rejects.toBe(primaryError)
    expect(first).toHaveBeenCalled()
    expect(second).toHaveBeenCalled()
  })

  it('preserves every original attempt error when all retries fail', async () => {
    vi.useFakeTimers()
    try {
      const first = makeApiError(429)
      const second = makeApiError(503)
      const primaryGenerate = vi.fn().mockRejectedValueOnce(first).mockRejectedValueOnce(second)
      const onRetryEvent = vi.fn()
      const wrap = createRetryableWrap({
        fallbacks: [],
        onRetryEvent,
        retryPolicy: policy({ maxAttempts: 1 })
      })

      const pending = Promise.resolve(
        wrap!(makeFakeLanguageModel('primary', primaryGenerate)).doGenerate({ prompt: [] })
      ).catch((caught: unknown) => caught)
      await vi.advanceTimersByTimeAsync(2_000)
      const caught = await pending

      expect(caught).toMatchObject({ errors: [first, second] })
      expect(onRetryEvent).toHaveBeenLastCalledWith({ state: 'settled' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries doStream when an error arrives before the first content part', async () => {
    vi.useFakeTimers()
    try {
      const streamError = makeApiError(429)
      const doStream = vi
        .fn()
        .mockResolvedValueOnce(
          streamResult([
            { type: 'stream-start', warnings: [] },
            { type: 'error', error: streamError }
          ])
        )
        .mockResolvedValueOnce(
          streamResult([
            { type: 'stream-start', warnings: [] },
            { type: 'text-delta', id: 'text', delta: 'ok' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
            }
          ])
        )
      const wrap = createRetryableWrap({
        fallbacks: [],
        retryPolicy: policy({ maxAttempts: 1 })
      })
      const wrapped = wrap!(makeFakeLanguageModel('primary', vi.fn(), doStream))

      const result = await wrapped.doStream({ prompt: [] })
      const collected = collectStream(result.stream)
      await vi.advanceTimersByTimeAsync(2_000)
      const parts = await collected

      expect(doStream).toHaveBeenCalledTimes(2)
      expect(parts).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'ok' }))
      expect(parts).not.toContainEqual(expect.objectContaining({ type: 'error' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retry a doStream error after content has already been emitted', async () => {
    const streamError = makeApiError(429)
    const doStream = vi.fn().mockResolvedValue(
      streamResult([
        { type: 'text-delta', id: 'text', delta: 'partial' },
        { type: 'error', error: streamError }
      ])
    )
    const wrap = createRetryableWrap({
      fallbacks: [],
      retryPolicy: policy({ maxAttempts: 2 })
    })
    const wrapped = wrap!(makeFakeLanguageModel('primary', vi.fn(), doStream))

    const result = await wrapped.doStream({ prompt: [] })
    const parts = await collectStream(result.stream)

    expect(doStream).toHaveBeenCalledOnce()
    expect(parts).toEqual([
      expect.objectContaining({ type: 'text-delta', delta: 'partial' }),
      { type: 'error', error: streamError }
    ])
  })
})
