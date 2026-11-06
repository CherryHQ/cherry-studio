import type { LanguageModelV3, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { APICallError } from 'ai'
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
