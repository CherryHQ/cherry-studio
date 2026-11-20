import type { LanguageModelV3, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { APICallError, RetryError } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import { withStreamContinuation } from '../streamContinuation'

type Script = { parts: LanguageModelV3StreamPart[]; readError?: Error }

function scripted(scripts: Script[]) {
  const doStream = vi.fn(async () => {
    const script = scripts.shift()!
    const parts = [...script.parts]
    return {
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        pull(controller) {
          const next = parts.shift()
          if (next) controller.enqueue(next)
          else if (script.readError) controller.error(script.readError)
          else controller.close()
        }
      })
    }
  })
  const model = {
    specificationVersion: 'v3',
    provider: 'p',
    modelId: 'm',
    supportedUrls: {},
    doStream
  } as unknown as LanguageModelV3
  return { model, doStream }
}

async function collect(stream: ReadableStream<LanguageModelV3StreamPart>) {
  const out: LanguageModelV3StreamPart[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return out
    out.push(value)
  }
}

const opts = { maxAttempts: 2, baseDelayMs: 0, backoffEnabled: false }
const callOptions = { prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] } as never
const finish = {
  type: 'finish',
  finishReason: { unified: 'stop', raw: 'stop' },
  usage: {}
} as unknown as LanguageModelV3StreamPart

describe('withStreamContinuation', () => {
  it('resumes an interrupted text stream into the same text part', async () => {
    const { model, doStream } = scripted([
      {
        parts: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'a' },
          { type: 'text-delta', id: 'a', delta: 'Hello ' }
        ],
        readError: new Error('socket hang up')
      },
      {
        parts: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'b' },
          { type: 'text-delta', id: 'b', delta: 'world' },
          { type: 'text-end', id: 'b' },
          finish
        ]
      }
    ])
    const onRetry = vi.fn()
    const result = await withStreamContinuation(model, { ...opts, onRetry }).doStream(callOptions)
    const parts = await collect(result.stream)

    expect(parts.map((p) => p.type)).toEqual([
      'stream-start',
      'text-start',
      'text-delta',
      'text-delta',
      'text-end',
      'finish'
    ])
    expect(parts.filter((p) => 'id' in p).every((p) => (p as { id: string }).id === 'a')).toBe(true)
    expect(onRetry).toHaveBeenCalledWith({ attempt: 1, reason: 'socket hang up' })
    const resumedPrompt = (doStream.mock.calls[1] as unknown as [{ prompt: unknown[] }])[0].prompt
    expect(resumedPrompt.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Hello ' }] })
  })

  it('surfaces an error when the replacement finishes with reason error and no error chunk', async () => {
    const errorFinish = {
      type: 'finish',
      finishReason: { unified: 'error', raw: undefined },
      usage: {}
    } as unknown as LanguageModelV3StreamPart
    const head: Script = {
      parts: [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'a' },
        { type: 'text-delta', id: 'a', delta: 'Hello ' }
      ],
      readError: new Error('socket hang up')
    }
    const failedReplacement: Script = {
      parts: [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'b' },
        { type: 'text-delta', id: 'b', delta: 'x' },
        errorFinish
      ]
    }
    const { model } = scripted([head, failedReplacement, { ...failedReplacement, parts: [...failedReplacement.parts] }])
    const result = await withStreamContinuation(model, opts).doStream(callOptions)
    const parts: LanguageModelV3StreamPart[] = []
    const reader = result.stream.getReader()
    let error: unknown
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
      }
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(Error)
    expect(parts.some((p) => p.type === 'finish')).toBe(false)
    expect(parts.some((p) => p.type === 'text-delta' && p.delta === 'x')).toBe(false)
  })

  it('keeps a provider-declared finish reason and does not retry it', async () => {
    const malformed = {
      type: 'finish',
      finishReason: { unified: 'error', raw: 'MALFORMED_FUNCTION_CALL' },
      providerMetadata: { google: { finishMessage: 'Malformed function call: bad args' } },
      usage: {}
    } as unknown as LanguageModelV3StreamPart
    const head: Script = {
      parts: [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'a' },
        { type: 'text-delta', id: 'a', delta: 'Hello ' }
      ],
      readError: new Error('socket hang up')
    }
    const replacement = (): Script => ({
      parts: [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'b' }, malformed]
    })
    const { model, doStream } = scripted([head, replacement(), replacement()])
    const result = await withStreamContinuation(model, { ...opts, maxAttempts: 3 }).doStream(callOptions)
    const reader = result.stream.getReader()
    let error: unknown
    try {
      while (!(await reader.read()).done);
    } catch (caught) {
      error = caught
    }
    expect((error as Error).message).toContain('MALFORMED_FUNCTION_CALL')
    expect((error as Error).message).toContain('bad args')
    expect(doStream).toHaveBeenCalledTimes(2)
  })

  it("drops a failed resume attempt's text instead of splicing or prefilling it", async () => {
    const { model, doStream } = scripted([
      {
        parts: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'a' },
          { type: 'text-delta', id: 'a', delta: 'Hello ' }
        ],
        readError: new Error('socket hang up')
      },
      // Provider ignores the prefill and restarts, then dies mid-reply.
      {
        parts: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'b' },
          { type: 'text-delta', id: 'b', delta: 'Hello w' }
        ],
        readError: new Error('connection reset')
      },
      {
        parts: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'c' },
          { type: 'text-delta', id: 'c', delta: 'world!' },
          { type: 'text-end', id: 'c' },
          finish
        ]
      }
    ])
    const result = await withStreamContinuation(model, { ...opts, maxAttempts: 3 }).doStream(callOptions)
    const parts = await collect(result.stream)

    const deltas = parts.filter((p) => p.type === 'text-delta').map((p) => (p as { delta: string }).delta)
    // The failed attempt's restart never reaches the reader: no repeated partial text.
    expect(deltas).toEqual(['Hello ', 'world!'])
    expect(parts.filter((p) => 'id' in p).every((p) => (p as { id: string }).id === 'a')).toBe(true)
    // The failed attempt's text is also excluded from the next prefill.
    const thirdPrompt = (doStream.mock.calls[2] as unknown as [{ prompt: unknown[] }])[0].prompt
    expect(thirdPrompt.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Hello ' }] })
  })

  it("emits only the original attempt's text when every resume attempt fails", async () => {
    const cut = (id: string, delta: string) => ({
      parts: [
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id },
        { type: 'text-delta', id, delta }
      ] as LanguageModelV3StreamPart[],
      readError: new Error('reset')
    })
    const { model } = scripted([cut('a', 'x'), cut('b', 'xy'), cut('c', 'xyz')])
    const result = await withStreamContinuation(model, opts).doStream(callOptions)
    const emitted: LanguageModelV3StreamPart[] = []
    const reader = result.stream.getReader()
    await expect(
      (async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) return
          emitted.push(value)
        }
      })()
    ).rejects.toThrow('reset')

    // Only the original (live-streamed) attempt's delta reached the reader.
    const deltas = emitted.filter((p) => p.type === 'text-delta').map((p) => (p as { delta: string }).delta)
    expect(deltas).toEqual(['x'])
  })

  it('surfaces the error once attempts are exhausted', async () => {
    const boom = () => ({
      parts: [
        { type: 'text-start', id: 'a' },
        { type: 'text-delta', id: 'a', delta: 'x' }
      ] as LanguageModelV3StreamPart[],
      readError: new Error('reset')
    })
    const { model, doStream } = scripted([boom(), boom(), boom()])
    const result = await withStreamContinuation(model, opts).doStream(callOptions)
    await expect(collect(result.stream)).rejects.toThrow('reset')
    expect(doStream).toHaveBeenCalledTimes(3)
  })

  it('does not resume when no content streamed or non-text content was emitted', async () => {
    const { model, doStream } = scripted([
      { parts: [{ type: 'stream-start', warnings: [] }], readError: new Error('early') },
      {
        parts: [
          { type: 'text-start', id: 'a' },
          { type: 'text-delta', id: 'a', delta: 'x' },
          { type: 'tool-input-start', id: 't', toolName: 'n' }
        ],
        readError: new Error('mid-tool')
      }
    ])
    const wrapped = withStreamContinuation(model, opts)
    await expect(collect((await wrapped.doStream(callOptions)).stream)).rejects.toThrow('early')
    await expect(collect((await wrapped.doStream(callOptions)).stream)).rejects.toThrow('mid-tool')
    expect(doStream).toHaveBeenCalledTimes(2)
  })

  it('stays non-resumable when a dropped buffered attempt emitted non-text content', async () => {
    const { model, doStream } = scripted([
      {
        parts: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'a' },
          { type: 'text-delta', id: 'a', delta: 'Hello ' }
        ],
        readError: new Error('socket hang up')
      },
      // The buffered attempt starts provider-side tool input, then dies. Its output is rolled
      // back, but the provider may already have run the tool: resuming would run it twice.
      {
        parts: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'b' },
          { type: 'text-delta', id: 'b', delta: 'dropped ' },
          { type: 'tool-input-start', id: 't', toolName: 'n' }
        ],
        readError: new Error('connection reset')
      },
      {
        parts: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'c' },
          { type: 'text-delta', id: 'c', delta: 'world!' },
          { type: 'text-end', id: 'c' },
          finish
        ]
      }
    ])
    const result = await withStreamContinuation(model, { ...opts, maxAttempts: 3 }).doStream(callOptions)
    await expect(collect(result.stream)).rejects.toThrow('connection reset')
    expect(doStream).toHaveBeenCalledTimes(2)
  })

  it('reports activity for each part of a buffered resumed attempt', async () => {
    const { model } = scripted([
      {
        parts: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'a' },
          { type: 'text-delta', id: 'a', delta: 'Hello ' }
        ],
        readError: new Error('socket hang up')
      },
      {
        parts: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'b' },
          { type: 'text-delta', id: 'b', delta: 'world' },
          { type: 'text-end', id: 'b' },
          finish
        ]
      }
    ])
    const onBufferedActivity = vi.fn()
    const result = await withStreamContinuation(model, { ...opts, onBufferedActivity }).doStream(callOptions)
    const parts = await collect(result.stream)
    expect(parts.some((p) => p.type === 'text-delta' && p.delta === 'world')).toBe(true)
    // text-start (adopted, not buffered) is skipped; delta, text-end and finish are buffered.
    expect(onBufferedActivity).toHaveBeenCalled()
  })

  it('does not resume non-retryable API errors', async () => {
    const apiError = new APICallError({
      message: 'bad',
      url: 'u',
      requestBodyValues: {},
      statusCode: 400,
      isRetryable: false
    })
    const { model, doStream } = scripted([
      {
        parts: [
          { type: 'text-start', id: 'a' },
          { type: 'text-delta', id: 'a', delta: 'x' },
          { type: 'error', error: apiError }
        ]
      }
    ])
    const parts = await collect((await withStreamContinuation(model, opts).doStream(callOptions)).stream)
    expect(parts.at(-1)).toMatchObject({ type: 'error' })
    expect(doStream).toHaveBeenCalledTimes(1)
  })
})

// Direct reader cancellation does not necessarily abort the provider signal.
it('does not start another provider call when cancelled during continuation backoff', async () => {
  vi.useFakeTimers()
  try {
    const { model, doStream } = scripted([
      {
        parts: [
          { type: 'text-start', id: 'a' },
          { type: 'text-delta', id: 'a', delta: 'partial' },
          { type: 'error', error: new Error('reset') }
        ]
      },
      {
        parts: [
          { type: 'text-start', id: 'b' },
          { type: 'text-delta', id: 'b', delta: 'unwanted' }
        ]
      }
    ])
    const onRetry = vi.fn()
    const result = await withStreamContinuation(model, { ...opts, baseDelayMs: 1000, onRetry }).doStream(callOptions)
    const reader = result.stream.getReader()
    await reader.read()
    await reader.read()
    const pending = reader.read()
    await vi.waitFor(() => expect(onRetry).toHaveBeenCalledOnce())
    await reader.cancel()
    await vi.advanceTimersByTimeAsync(1000)
    await pending
    expect(doStream).toHaveBeenCalledTimes(1)
  } finally {
    vi.useRealTimers()
  }
})

it('resumes an incomplete successful HTTP response body without retrying permanent API rejection', async () => {
  const error = new APICallError({
    message: 'terminated',
    url: 'https://fixture.invalid',
    requestBodyValues: {},
    statusCode: 200,
    isRetryable: false,
    cause: new TypeError('terminated')
  })
  const { model, doStream } = scripted([
    {
      parts: [
        { type: 'text-start', id: 'a' },
        { type: 'text-delta', id: 'a', delta: 'partial' }
      ],
      readError: error
    },
    {
      parts: [
        { type: 'text-start', id: 'b' },
        { type: 'text-delta', id: 'b', delta: ' rest' },
        { type: 'text-end', id: 'b' },
        finish
      ]
    }
  ])
  const parts = await collect((await withStreamContinuation(model, opts).doStream(callOptions)).stream)
  expect(doStream).toHaveBeenCalledTimes(2)
  expect(
    parts
      .filter((part) => part.type === 'text-delta')
      .map((part) => part.delta)
      .join('')
  ).toBe('partial rest')
})

it('cancels a replacement stream that arrives after reader cancellation', async () => {
  let resolveReplacement!: (value: { stream: ReadableStream<LanguageModelV3StreamPart> }) => void
  const pendingReplacement = new Promise<{ stream: ReadableStream<LanguageModelV3StreamPart> }>((resolve) => {
    resolveReplacement = resolve
  })
  const cancelled = vi.fn()
  const replacement = new ReadableStream<LanguageModelV3StreamPart>({ cancel: cancelled })
  const { model, doStream } = scripted([
    {
      parts: [
        { type: 'text-start', id: 'a' },
        { type: 'text-delta', id: 'a', delta: 'partial' },
        { type: 'error', error: new Error('reset') }
      ]
    }
  ])
  doStream
    .mockImplementationOnce(async () => ({
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: 'a' })
          controller.enqueue({ type: 'text-delta', id: 'a', delta: 'partial' })
          controller.enqueue({ type: 'error', error: new Error('reset') })
        }
      })
    }))
    .mockImplementationOnce(() => pendingReplacement)
  const onSettled = vi.fn()
  const reader = (await withStreamContinuation(model, { ...opts, onSettled }).doStream(callOptions)).stream.getReader()
  await reader.read()
  await reader.read()
  const reading = reader.read()
  await vi.waitFor(() => expect(doStream).toHaveBeenCalledTimes(2))
  await reader.cancel()
  resolveReplacement({ stream: replacement })
  await reading
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce())
  expect(onSettled).toHaveBeenCalledOnce()
})

it.each([400, 401, 429, 500])(
  'does not reinterpret permanent HTTP %s as a successful transport failure',
  async (statusCode) => {
    const error = new APICallError({
      message: 'rejected',
      url: 'https://fixture.invalid',
      requestBodyValues: {},
      statusCode,
      isRetryable: false,
      cause: new TypeError('terminated')
    })
    const { model, doStream } = scripted([
      {
        parts: [
          { type: 'text-start', id: 'a' },
          { type: 'text-delta', id: 'a', delta: 'partial' },
          { type: 'error', error }
        ]
      }
    ])
    const parts = await collect((await withStreamContinuation(model, opts).doStream(callOptions)).stream)
    expect(parts.at(-1)).toEqual({ type: 'error', error })
    expect(doStream).toHaveBeenCalledOnce()
  }
)

it.each([
  [
    'permanent response',
    new APICallError({
      message: 'invalid',
      url: 'https://test',
      requestBodyValues: {},
      statusCode: 400,
      isRetryable: false,
      cause: new Error('connection reset')
    })
  ],
  ['abort', new DOMException('aborted', 'AbortError')]
])('does not resume a wrapped %s after partial text', async (_name, lastError) => {
  const wrapped = new RetryError({
    message: 'failed',
    reason: 'maxRetriesExceeded',
    errors: [new Error('earlier'), lastError]
  })
  const { model, doStream } = scripted([
    {
      parts: [
        { type: 'text-start', id: 'a' },
        { type: 'text-delta', id: 'a', delta: 'partial' },
        { type: 'error', error: wrapped }
      ]
    }
  ])
  const result = await withStreamContinuation(model, opts).doStream(callOptions)
  expect(await collect(result.stream)).toContainEqual({ type: 'error', error: wrapped })
  expect(doStream).toHaveBeenCalledOnce()
})
