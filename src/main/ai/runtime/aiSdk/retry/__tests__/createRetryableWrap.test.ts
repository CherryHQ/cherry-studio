import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { APICallError, generateText, type ModelMessage, wrapLanguageModel } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { routeToolResultMedia } from '../../../../messages/messageCapabilities'
import { providerErrorBoundaryMiddleware } from '../../params/features/providerErrorBoundary'
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

function budgetError(message: string, body: unknown, statusCode = 400, responseBody?: string) {
  return new APICallError({ message, url: 'https://api.test/v1', requestBodyValues: body, statusCode, responseBody })
}

describe('createRetryableWrap', () => {
  it.each([
    ['max_tokens', 'Invalid max_tokens value, the valid range of max_tokens is [1, 4096]', 4096],
    ['max_tokens', 'Range of max_tokens should be [1, 4096]', 4096],
    ['max_tokens', 'max_tokens参数非法：限制数值范围[1,4096]', 4096],
    [
      'max_tokens',
      'max_tokens specified in the request are not valid: integer above maximum value, expected a value <= 4096, but got 8192 instead.',
      4096
    ],
    [
      'max_completion_tokens',
      'max_completion_tokens=8192 cannot be greater than max_model_len=max_total_tokens=4096',
      4096
    ],
    ['max_completion_tokens', 'max_completion_tokens is limited to 4096', 4096],
    ['max_output_tokens', "Field 'max_output_tokens' must be at most 4096", 4096],
    [
      'gemini',
      'Unable to submit request because it has a maxOutputTokens value of 8192 but the supported range is from 1 (inclusive) to 4096 (exclusive).',
      4095
    ]
  ])('recovers %s from the provider ceiling in %s', async (field, message, ceiling) => {
    const budgets: (number | undefined)[] = []
    const model = makeFakeLanguageModel(
      'primary',
      vi.fn(async ({ maxOutputTokens }: LanguageModelV3CallOptions) => {
        budgets.push(maxOutputTokens)
        if (maxOutputTokens !== ceiling) {
          const body = field === 'gemini' ? { generationConfig: { maxOutputTokens } } : { [field]: maxOutputTokens }
          throw budgetError(message, body)
        }
        return okResult
      })
    )
    const wrap = createRetryableWrap({ fallbacks: [], retryPolicy: policy({ enabled: false }), outputTokenRetries: 3 })!
    await expect(wrap(model).doGenerate({ prompt: [], maxOutputTokens: 8192 })).resolves.toMatchObject({
      content: [{ type: 'text', text: 'ok' }]
    })
    expect(budgets).toEqual([8192, ceiling])
  })

  it('decreases the budget on each explicit overflow and preserves the last provider error on exhaustion', async () => {
    const budgets: (number | undefined)[] = []
    const model = makeFakeLanguageModel(
      'primary',
      vi.fn(async ({ maxOutputTokens }: LanguageModelV3CallOptions) => {
        budgets.push(maxOutputTokens)
        throw budgetError(
          'Param Incorrect',
          { max_completion_tokens: maxOutputTokens },
          422,
          JSON.stringify({
            error: { param: 'max_completion_tokens is too large' },
            request_id: String(maxOutputTokens)
          })
        )
      })
    )
    const wrap = createRetryableWrap({ fallbacks: [], retryPolicy: policy({ enabled: false }), outputTokenRetries: 3 })!
    await expect(wrap(model).doGenerate({ prompt: [], maxOutputTokens: 8192 })).rejects.toMatchObject({
      lastError: { statusCode: 422, responseBody: expect.stringContaining('"request_id":"1024"') }
    })
    expect(budgets).toEqual([8192, 4096, 2048, 1024])
  })

  it.each([
    ['max_tokens is not supported; use max_completion_tokens instead', { max_tokens: 8192 }],
    ['max_tokens value is outside the valid range', { max_tokens: 8192 }],
    ['Invalid max_tokens value, the valid range of max_tokens is [1, 8192]', { max_tokens: 8192 }],
    ['Conversation exceeds the context window', { max_tokens: 8192 }],
    ['max_tokens must be at most 4096', { max_tokens: 16384 }],
    ['max_tokens must be at most 4096', { max_tokens: 13192, thinking: { budget_tokens: 5000 } }]
  ])('preserves a rejection that cannot be recovered by lowering the SDK budget: %s', async (message, body) => {
    const failure = budgetError(message, body)
    const generate = vi.fn().mockRejectedValue(failure)
    const model = makeFakeLanguageModel('primary', generate)
    const wrap = createRetryableWrap({ fallbacks: [], retryPolicy: policy({ enabled: false }), outputTokenRetries: 3 })!
    // The reasoning case reports a lower ceiling than its thinking allocation.
    await expect(wrap(model).doGenerate({ prompt: [], maxOutputTokens: 8192 })).rejects.toBe(failure)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('keeps the lowered budget across a subsequent transient failure', async () => {
    const budgets: (number | undefined)[] = []
    const model = makeFakeLanguageModel(
      'primary',
      vi.fn(async ({ maxOutputTokens }: LanguageModelV3CallOptions) => {
        budgets.push(maxOutputTokens)
        if (maxOutputTokens === 8192) throw budgetError('max_tokens must be at most 4096', { max_tokens: 8192 })
        if (budgets.length === 2) {
          throw new APICallError({
            message: 'temporary failure',
            url: 'https://api.test/v1',
            requestBodyValues: {},
            statusCode: 503,
            responseHeaders: { 'retry-after': '0.001' }
          })
        }
        return okResult
      })
    )
    const wrap = createRetryableWrap({ fallbacks: [], retryPolicy: policy(), outputTokenRetries: 2 })!
    await expect(wrap(model).doGenerate({ prompt: [], maxOutputTokens: 8192 })).resolves.toMatchObject({
      content: [{ type: 'text', text: 'ok' }]
    })
    expect(budgets).toEqual([8192, 4096, 4096])
  })

  it.each([503, 400])(
    'uses the effective budget of a lowered stream that emits HTTP %s before content',
    async (status) => {
      const budgets: (number | undefined)[] = []
      const nextBudget = status === 400 ? 2048 : 4096
      const doStream = vi.fn(async ({ maxOutputTokens }: LanguageModelV3CallOptions) => {
        budgets.push(maxOutputTokens)
        if (budgets.length === 1) throw budgetError('max_tokens must be at most 4096', { max_tokens: maxOutputTokens })
        if (budgets.length === 2) {
          const error =
            status === 400
              ? budgetError('max_tokens must be at most 2048', { max_tokens: maxOutputTokens })
              : new APICallError({
                  message: 'temporary failure',
                  url: 'https://api.test/v1',
                  requestBodyValues: { max_tokens: maxOutputTokens },
                  statusCode: 503,
                  responseHeaders: { 'retry-after': '0.001' }
                })
          return streamResult([
            { type: 'stream-start', warnings: [] },
            { type: 'error', error }
          ])
        }
        return streamResult([{ type: 'text-delta', id: 'text', delta: 'ok' }])
      })
      const wrap = createRetryableWrap({
        fallbacks: [],
        retryPolicy: { ...policy(), maxAttempts: 3 },
        outputTokenRetries: 3
      })!
      const result = await wrap(makeFakeLanguageModel('primary', vi.fn(), doStream)).doStream({
        prompt: [],
        maxOutputTokens: 8192
      })
      expect(await collectStream(result.stream)).toEqual([{ type: 'text-delta', id: 'text', delta: 'ok' }])
      expect(budgets).toEqual([8192, 4096, nextBudget])
    }
  )

  it('does not resend an unchanged OpenAI completion budget when the provider option owns the field', async () => {
    const budgets: number[] = []
    const providerFetch: typeof fetch = async (_url, init) => {
      budgets.push(JSON.parse(String(init?.body)).max_completion_tokens)
      return Response.json({ error: { message: 'max_completion_tokens must be at most 4096' } }, { status: 400 })
    }
    const model = createOpenAI({ apiKey: 'fixture', fetch: providerFetch }).chat('o3')
    const wrap = createRetryableWrap({ fallbacks: [], retryPolicy: policy({ enabled: false }), outputTokenRetries: 3 })!
    await expect(
      wrap(model).doGenerate({
        prompt: [],
        maxOutputTokens: 8192,
        providerOptions: { openai: { maxCompletionTokens: 8192 } }
      })
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(budgets).toEqual([8192])
  })

  it('does not dispatch a reduced request after cancellation', async () => {
    const abort = new AbortController()
    const failure = budgetError('max_tokens must be at most 4096', { max_tokens: 8192 })
    const generate = vi.fn(async () => {
      abort.abort()
      throw failure
    })
    const wrap = createRetryableWrap({ fallbacks: [], retryPolicy: policy({ enabled: false }), outputTokenRetries: 3 })!
    const model = wrap(makeFakeLanguageModel('primary', generate))
    await expect(model.doGenerate({ prompt: [], maxOutputTokens: 8192, abortSignal: abort.signal })).rejects.toBe(
      failure
    )
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it.each(['original', 'missing'])('continues a signed tool result on its %s fallback route', async (origin) => {
    const calls: Array<{ route: string; params: LanguageModelV3CallOptions }> = []
    const record = (route: string) =>
      vi.fn(async (params: LanguageModelV3CallOptions) => {
        calls.push({ route, params })
        return okResult
      })
    const wrap = createRetryableWrap({
      primaryReplayRouteId: 'primary',
      retryPolicy: policy(),
      fallbacks: [
        async () => ({ model: makeFakeLanguageModel('original', record('original')), replayRouteId: 'original' })
      ]
    })!
    const wrapped = wrap(makeFakeLanguageModel('primary', record('primary')))
    const params: LanguageModelV3CallOptions = {
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'Look up cedar' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'lookup-1',
              toolName: 'lookup',
              input: {},
              providerOptions: { cherry: { replayRouteId: origin }, google: { thoughtSignature: 'tool-signature' } }
            }
          ]
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'lookup-1',
              toolName: 'lookup',
              output: { type: 'text', value: 'Cedar' }
            }
          ]
        }
      ]
    }
    if (origin === 'missing') {
      await expect(wrapped.doGenerate(params)).rejects.toThrow('tool results were retained')
      expect(calls).toEqual([])
    } else {
      await wrapped.doGenerate(params)
      expect(calls).toEqual([{ route: 'original', params }])
    }
  })

  it('returns undefined when retry is disabled', () => {
    expect(createRetryableWrap({ fallbacks: [], retryPolicy: policy({ enabled: false }) })).toBeUndefined()
  })

  it('keeps a signed tool continuation on its fallback after relocating the tool image', async () => {
    const primary = vi.fn().mockResolvedValue(okResult)
    const fallback = vi.fn().mockResolvedValue(okResult)
    const wrap = createRetryableWrap({
      primaryReplayRouteId: 'primary',
      retryPolicy: policy(),
      fallbacks: [async () => ({ model: makeFakeLanguageModel('serving', fallback), replayRouteId: 'serving' })]
    })!
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Read the image' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'read-1',
            toolName: 'read',
            input: {},
            providerOptions: { cherry: { replayRouteId: 'serving' }, google: { thoughtSignature: 'original' } }
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'read-1',
            toolName: 'read',
            output: { type: 'content', value: [{ type: 'image-data', data: 'AQID', mediaType: 'image/png' }] }
          }
        ]
      }
    ]
    const result = await generateText({
      model: wrap(makeFakeLanguageModel('primary', primary)),
      messages: routeToolResultMedia(
        messages,
        { image: true, audio: false, video: false },
        { image: false, audio: false, video: false }
      ),
      maxRetries: 0
    })
    expect(result.text).toBe('ok')
    expect(primary).not.toHaveBeenCalled()
    expect(fallback.mock.calls[0][0].prompt).toMatchObject([
      { role: 'user' },
      {
        role: 'assistant',
        content: [{ toolCallId: 'read-1', providerOptions: { google: { thoughtSignature: 'original' } } }]
      },
      { role: 'tool', content: [{ toolCallId: 'read-1' }] },
      { role: 'user', content: [{ type: 'text' }, { type: 'file', mediaType: 'image/png' }] }
    ])
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

  it('notifies the caller when a fallback is activated', async () => {
    const repairToolCall = vi.fn()
    const onFallbackActivated = vi.fn()
    const fallback = makeFakeLanguageModel('claude-x', vi.fn().mockResolvedValue(okResult))
    const wrap = createRetryableWrap({
      fallbacks: [() => Promise.resolve({ model: fallback, repairToolCall })],
      onFallbackActivated,
      retryPolicy: policy()
    })

    await wrap!(makeFakeLanguageModel('gpt-4', vi.fn().mockRejectedValue(makeApiError(401)))).doGenerate({
      prompt: []
    })

    expect(onFallbackActivated).toHaveBeenCalledOnce()
    expect(onFallbackActivated).toHaveBeenCalledWith(expect.objectContaining({ model: fallback, repairToolCall }))
  })

  it('reactivates the primary before the next model operation', async () => {
    const activations: string[] = []
    const primaryGenerate = vi.fn().mockRejectedValueOnce(makeApiError(401)).mockResolvedValueOnce(okResult)
    const wrap = createRetryableWrap({
      fallbacks: [
        () =>
          Promise.resolve({
            model: makeFakeLanguageModel('claude-x', vi.fn().mockResolvedValue(okResult))
          })
      ],
      onPrimaryActivated: () => activations.push('primary'),
      onFallbackActivated: () => activations.push('fallback'),
      retryPolicy: policy()
    })
    const wrapped = wrap!(makeFakeLanguageModel('gpt-4', primaryGenerate))

    await wrapped.doGenerate({ prompt: [] })
    await wrapped.doGenerate({ prompt: [] })

    expect(activations).toEqual(['primary', 'fallback', 'primary'])
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

  it('surfaces context overflow even when the provider marks it retryable', async () => {
    const overflow = new APICallError({
      url: 'https://provider.invalid',
      requestBodyValues: {},
      statusCode: 400,
      message: 'Invalid request',
      data: { error: { code: 'context_length_exceeded' } },
      isRetryable: true
    })
    const generate = vi.fn().mockRejectedValueOnce(overflow).mockResolvedValue(okResult)
    const wrap = createRetryableWrap({ fallbacks: [], retryPolicy: policy() })
    const model = wrapLanguageModel({
      model: makeFakeLanguageModel('gpt-4', generate),
      middleware: providerErrorBoundaryMiddleware
    })
    await expect(wrap!(model).doGenerate({ prompt: [] })).rejects.toMatchObject({
      providerErrorCategory: 'context_length',
      isRetryable: false,
      statusCode: 400
    })
    expect(generate).toHaveBeenCalledTimes(1)
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

      await vi.advanceTimersByTimeAsync(1_999)
      expect(primaryGenerate).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)

      await vi.advanceTimersByTimeAsync(3_999)

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

  it.each([makeApiError(429), budgetError('max_tokens must be at most 4096', { max_tokens: 8192 })])(
    'does not retry a doStream error after content has already been emitted: $message',
    async (streamError) => {
      const doStream = vi.fn().mockResolvedValue(
        streamResult([
          { type: 'text-delta', id: 'text', delta: 'partial' },
          { type: 'error', error: streamError }
        ])
      )
      const wrap = createRetryableWrap({
        fallbacks: [],
        retryPolicy: policy({ maxAttempts: 2 }),
        outputTokenRetries: 2
      })
      const wrapped = wrap!(makeFakeLanguageModel('primary', vi.fn(), doStream))

      const result = await wrapped.doStream({ prompt: [], maxOutputTokens: 8192 })
      const parts = await collectStream(result.stream)

      expect(doStream).toHaveBeenCalledOnce()
      expect(parts).toEqual([
        expect.objectContaining({ type: 'text-delta', delta: 'partial' }),
        { type: 'error', error: streamError }
      ])
    }
  )
})
