import type { LanguageModelV3 } from '@ai-sdk/provider'
import { APICallError } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import type { FallbackResolver } from '../createRetryableWrap'
import { createRetryableWrap } from '../createRetryableWrap'
import type { RetryPolicy } from '../retryPolicy'

function makeApiError(statusCode: number): APICallError {
  return new APICallError({
    message: `http ${statusCode}`,
    url: 'https://api.test/v1',
    requestBodyValues: {},
    statusCode,
    isRetryable: statusCode === 429 || statusCode >= 500
  })
}

const okResult = {
  content: [{ type: 'text' as const, text: 'ok' }],
  finishReason: { unified: 'stop' as const, raw: 'stop' },
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  warnings: []
}

const toolCallResult = {
  content: [
    {
      type: 'tool-call' as const,
      toolCallId: 'tool-call-1',
      toolName: 'lookup',
      input: '{}'
    }
  ],
  finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
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

function fallbackOf(model: LanguageModelV3): FallbackResolver {
  return () => Promise.resolve({ model })
}

function policy(enabled: boolean): RetryPolicy {
  return { enabled, maxAttempts: 2, backoffEnabled: false, fallbackModelIds: [] }
}

describe('createRetryableWrap API key failover', () => {
  it('fails over 401 and 429 across API keys even when model retry is disabled', async () => {
    const attempts: string[] = []
    const secondKeyGenerate = vi.fn(async () => {
      attempts.push('key-2')
      throw makeApiError(429)
    })
    const thirdKeyGenerate = vi.fn(async () => {
      attempts.push('key-3')
      return okResult
    })
    const wrap = createRetryableWrap({
      apiKeyFallbacks: [
        fallbackOf(makeFakeLanguageModel('same-model', secondKeyGenerate)),
        fallbackOf(makeFakeLanguageModel('same-model', thirdKeyGenerate))
      ],
      fallbacks: [],
      retryPolicy: policy(false)
    })
    const primaryGenerate = vi.fn(async () => {
      attempts.push('key-1')
      throw makeApiError(401)
    })

    const result = await wrap!(makeFakeLanguageModel('same-model', primaryGenerate)).doGenerate({ prompt: [] } as never)

    expect(attempts).toEqual(['key-1', 'key-2', 'key-3'])
    expect(result.content).toEqual(okResult.content)
  })

  it('keeps the active key across tool-loop operations and advances only after another auth failure', async () => {
    const attempts: string[] = []
    const secondKeyGenerate = vi
      .fn<() => Promise<typeof okResult | typeof toolCallResult>>()
      .mockImplementationOnce(async () => {
        attempts.push('key-2')
        return toolCallResult
      })
      .mockImplementationOnce(async () => {
        attempts.push('key-2')
        throw makeApiError(429)
      })
    const thirdKeyGenerate = vi.fn(async () => {
      attempts.push('key-3')
      return okResult
    })
    const wrap = createRetryableWrap({
      apiKeyFallbacks: [
        fallbackOf(makeFakeLanguageModel('same-model', secondKeyGenerate)),
        fallbackOf(makeFakeLanguageModel('same-model', thirdKeyGenerate))
      ],
      fallbacks: [],
      retryPolicy: policy(false)
    })
    const primaryGenerate = vi.fn(async () => {
      attempts.push('key-1')
      throw makeApiError(401)
    })
    const wrapped = wrap!(makeFakeLanguageModel('same-model', primaryGenerate))

    const firstStep = await wrapped.doGenerate({ prompt: [] } as never)
    const secondStep = await wrapped.doGenerate({ prompt: [] } as never)

    expect(firstStep.content).toEqual(toolCallResult.content)
    expect(secondStep.content).toEqual(okResult.content)
    expect(attempts).toEqual(['key-1', 'key-2', 'key-2', 'key-3'])
  })

  it('tries each API key once before cross-model fallback without same-key backoff', async () => {
    const attempts: string[] = []
    const secondKeyGenerate = vi.fn(async () => {
      attempts.push('key-2')
      throw makeApiError(429)
    })
    const fallbackGenerate = vi.fn(async () => {
      attempts.push('fallback-model')
      return okResult
    })
    const wrap = createRetryableWrap({
      apiKeyFallbacks: [fallbackOf(makeFakeLanguageModel('same-model', secondKeyGenerate))],
      fallbacks: [fallbackOf(makeFakeLanguageModel('fallback-model', fallbackGenerate))],
      retryPolicy: policy(true)
    })
    const primaryGenerate = vi.fn(async () => {
      attempts.push('key-1')
      throw makeApiError(429)
    })

    await wrap!(makeFakeLanguageModel('same-model', primaryGenerate)).doGenerate({ prompt: [] } as never)

    expect(attempts).toEqual(['key-1', 'key-2', 'fallback-model'])
  })

  it('retries a replacement key for transient errors before cross-model fallback', async () => {
    vi.useFakeTimers()
    try {
      const attempts: string[] = []
      const onRetryEvent = vi.fn()
      const secondKeyGenerate = vi
        .fn<() => Promise<typeof okResult>>()
        .mockImplementationOnce(async () => {
          attempts.push('key-2')
          throw makeApiError(503)
        })
        .mockImplementationOnce(async () => {
          attempts.push('key-2')
          return okResult
        })
      const wrap = createRetryableWrap({
        apiKeyFallbacks: [fallbackOf(makeFakeLanguageModel('same-model', secondKeyGenerate))],
        fallbacks: [],
        onRetryEvent,
        retryPolicy: policy(true)
      })
      const primaryGenerate = vi.fn(async () => {
        attempts.push('key-1')
        throw makeApiError(401)
      })

      const pending = wrap!(makeFakeLanguageModel('same-model', primaryGenerate)).doGenerate({ prompt: [] } as never)
      await vi.advanceTimersByTimeAsync(2_000)
      await pending

      expect(attempts).toEqual(['key-1', 'key-2', 'key-2'])
      expect(onRetryEvent).toHaveBeenCalledTimes(3)
      expect(onRetryEvent).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ state: 'retrying', modelId: 'same-model', attempt: 2, reason: 'http 401: http 401' })
      )
      expect(onRetryEvent).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ state: 'retrying', modelId: 'same-model', attempt: 2, reason: 'http 503: http 503' })
      )
      expect(onRetryEvent).toHaveBeenLastCalledWith({ state: 'settled' })
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([401, 429])('continues key failover when replacement-key retry ends with HTTP %s', async (statusCode) => {
    vi.useFakeTimers()
    try {
      const attempts: string[] = []
      const secondKeyGenerate = vi
        .fn<() => Promise<typeof okResult>>()
        .mockImplementationOnce(async () => {
          attempts.push('key-2')
          throw makeApiError(503)
        })
        .mockImplementationOnce(async () => {
          attempts.push('key-2')
          throw makeApiError(statusCode)
        })
      const thirdKeyGenerate = vi.fn(async () => {
        attempts.push('key-3')
        return okResult
      })
      const wrap = createRetryableWrap({
        apiKeyFallbacks: [
          fallbackOf(makeFakeLanguageModel('same-model', secondKeyGenerate)),
          fallbackOf(makeFakeLanguageModel('same-model', thirdKeyGenerate))
        ],
        fallbacks: [],
        retryPolicy: policy(true)
      })
      const primaryGenerate = vi.fn(async () => {
        attempts.push('key-1')
        throw makeApiError(401)
      })

      const pending = wrap!(makeFakeLanguageModel('same-model', primaryGenerate)).doGenerate({ prompt: [] } as never)
      await vi.advanceTimersByTimeAsync(2_000)
      await pending

      expect(attempts).toEqual(['key-1', 'key-2', 'key-2', 'key-3'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves API key errors in order when every key fails', async () => {
    const firstError = makeApiError(401)
    const lastError = makeApiError(429)
    const wrap = createRetryableWrap({
      apiKeyFallbacks: [fallbackOf(makeFakeLanguageModel('same-model', vi.fn().mockRejectedValue(lastError)))],
      fallbacks: [],
      retryPolicy: policy(false)
    })
    const wrapped = wrap!(makeFakeLanguageModel('same-model', vi.fn().mockRejectedValue(firstError)))

    await expect(wrapped.doGenerate({ prompt: [] } as never)).rejects.toMatchObject({ errors: [firstError, lastError] })
  })

  it.each([400, 503])('does not fail over API keys for HTTP %s', async (statusCode) => {
    const keyFallback = vi.fn(fallbackOf(makeFakeLanguageModel('same-model', vi.fn().mockResolvedValue(okResult))))
    const error = makeApiError(statusCode)
    const wrap = createRetryableWrap({
      apiKeyFallbacks: [keyFallback],
      fallbacks: [],
      retryPolicy: policy(false)
    })
    const wrapped = wrap!(makeFakeLanguageModel('same-model', vi.fn().mockRejectedValue(error)))

    await expect(wrapped.doGenerate({ prompt: [] } as never)).rejects.toBe(error)
    expect(keyFallback).not.toHaveBeenCalled()
  })

  it('fails over a stream error before content is emitted', async () => {
    const streamError = makeApiError(401)
    const fallbackStream = vi.fn().mockResolvedValue(
      streamResult([
        { type: 'text-delta', id: 'text', delta: 'ok' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage: okResult.usage }
      ])
    )
    const primaryStream = vi.fn().mockResolvedValue(
      streamResult([
        { type: 'stream-start', warnings: [] },
        { type: 'error', error: streamError }
      ])
    )
    const wrap = createRetryableWrap({
      apiKeyFallbacks: [fallbackOf(makeFakeLanguageModel('same-model', vi.fn(), fallbackStream))],
      fallbacks: [],
      retryPolicy: policy(false)
    })

    const result = await wrap!(makeFakeLanguageModel('same-model', vi.fn(), primaryStream)).doStream({
      prompt: []
    } as never)

    expect(await collectStream(result.stream)).toContainEqual(
      expect.objectContaining({ type: 'text-delta', delta: 'ok' })
    )
    expect(primaryStream).toHaveBeenCalledOnce()
    expect(fallbackStream).toHaveBeenCalledOnce()
  })

  it('does not fail over API keys after stream content has been emitted', async () => {
    const streamError = makeApiError(429)
    const fallbackStream = vi.fn().mockResolvedValue(streamResult([]))
    const primaryStream = vi.fn().mockResolvedValue(
      streamResult([
        { type: 'text-delta', id: 'text', delta: 'partial' },
        { type: 'error', error: streamError }
      ])
    )
    const wrap = createRetryableWrap({
      apiKeyFallbacks: [fallbackOf(makeFakeLanguageModel('same-model', vi.fn(), fallbackStream))],
      fallbacks: [],
      retryPolicy: policy(false)
    })
    const result = await wrap!(makeFakeLanguageModel('same-model', vi.fn(), primaryStream)).doStream({
      prompt: []
    } as never)

    expect(await collectStream(result.stream)).toEqual([
      expect.objectContaining({ type: 'text-delta', delta: 'partial' }),
      { type: 'error', error: streamError }
    ])
    expect(fallbackStream).not.toHaveBeenCalled()
  })
})
