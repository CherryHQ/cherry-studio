import type { LanguageModelV3, LanguageModelV3Prompt, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { APICallError, stepCountIs, streamText, tool, wrapLanguageModel } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { createOverflowRecoveryMiddleware } from '../contextOverflowRecovery'

const overflow = () =>
  new APICallError({
    message: 'context_length_exceeded',
    url: 'https://example.com',
    requestBodyValues: {},
    statusCode: 400
  })

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined }
}

function modelStream(parts: LanguageModelV3StreamPart[]): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    }
  })
}

async function collect(stream: ReadableStream<LanguageModelV3StreamPart>): Promise<LanguageModelV3StreamPart[]> {
  const reader = stream.getReader()
  const parts: LanguageModelV3StreamPart[] = []
  while (true) {
    const next = await reader.read()
    if (next.done) return parts
    parts.push(next.value)
  }
}

describe('context overflow recovery', () => {
  it('retries only the failed model step after a completed tool call', async () => {
    let calls = 0
    let toolExecutions = 0
    const prompts: LanguageModelV3Prompt[] = []
    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'test',
      modelId: 'test',
      supportedUrls: {},
      async doGenerate() {
        throw new Error('not used')
      },
      async doStream({ prompt }) {
        prompts.push(prompt)
        calls++
        if (calls === 2) throw overflow()
        if (calls === 1) {
          return {
            stream: modelStream([
              { type: 'stream-start', warnings: [] },
              { type: 'tool-call', toolCallId: 'call-1', toolName: 'lookup', input: '{}' },
              { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage }
            ])
          }
        }
        return {
          stream: modelStream([
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'text' },
            { type: 'text-delta', id: 'text', delta: 'done' },
            { type: 'text-end', id: 'text' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage }
          ])
        }
      }
    }
    const wrapped = wrapLanguageModel({
      model,
      middleware: createOverflowRecoveryMiddleware(async (prompt) => [
        { role: 'user', content: [{ type: 'text', text: 'earlier summary' }] },
        ...prompt.slice(2)
      ])
    })
    const result = streamText({
      model: wrapped,
      messages: [
        { role: 'user', content: 'old question' },
        { role: 'assistant', content: 'old answer' },
        { role: 'user', content: 'current request' }
      ],
      tools: {
        lookup: tool({
          inputSchema: z.object({}),
          execute: async () => {
            toolExecutions++
            return 'result'
          }
        })
      },
      stopWhen: stepCountIs(5),
      maxRetries: 0
    })
    expect(await result.text).toBe('done')
    expect(toolExecutions).toBe(1)
    expect(calls).toBe(3)
    expect(prompts[2].some((message) => message.role === 'tool')).toBe(true)
    expect(JSON.stringify(prompts[2])).toContain('earlier summary')
  })

  it('does not compact unrelated HTTP 400 errors', async () => {
    const failure = new APICallError({
      message: 'invalid parameter',
      url: 'test',
      requestBodyValues: {},
      statusCode: 400
    })
    let compactions = 0
    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'test',
      modelId: 'test',
      supportedUrls: {},
      async doGenerate() {
        throw failure
      },
      async doStream() {
        throw failure
      }
    }
    const wrapped = wrapLanguageModel({
      model,
      middleware: createOverflowRecoveryMiddleware(async () => {
        compactions++
        return undefined
      })
    })
    await expect(wrapped.doStream({ prompt: [] })).rejects.toBe(failure)
    expect(compactions).toBe(0)
  })

  it('recovers an overflow delivered as an initial stream error', async () => {
    let attempts = 0
    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'test',
      modelId: 'test',
      supportedUrls: {},
      async doGenerate() {
        throw new Error('not used')
      },
      async doStream() {
        attempts++
        return {
          stream: modelStream(
            attempts === 1
              ? [
                  { type: 'stream-start', warnings: [] },
                  { type: 'error', error: overflow() }
                ]
              : [
                  { type: 'text-start', id: 'a' },
                  { type: 'text-delta', id: 'a', delta: 'ok' }
                ]
          )
        }
      }
    }
    const wrapped = wrapLanguageModel({ model, middleware: createOverflowRecoveryMiddleware(async () => []) })
    const result = await wrapped.doStream({ prompt: [] })
    const parts = await collect(result.stream)
    expect(parts.some((part) => part.type === 'text-delta' && part.delta === 'ok')).toBe(true)
    expect(attempts).toBe(2)
  })

  it('does not retry an error after output has started', async () => {
    let compactions = 0
    const failure = overflow()
    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'test',
      modelId: 'test',
      supportedUrls: {},
      async doGenerate() {
        throw new Error('not used')
      },
      async doStream() {
        return {
          stream: modelStream([
            { type: 'text-start', id: 'a' },
            { type: 'text-delta', id: 'a', delta: 'partial' },
            { type: 'error', error: failure }
          ])
        }
      }
    }
    const wrapped = wrapLanguageModel({
      model,
      middleware: createOverflowRecoveryMiddleware(async () => {
        compactions++
        return []
      })
    })
    const result = await wrapped.doStream({ prompt: [] })
    const parts = await collect(result.stream)
    expect(parts).toContainEqual({ type: 'error', error: failure })
    expect(compactions).toBe(0)
  })

  it('returns the original overflow when compaction fails', async () => {
    const failure = overflow()
    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'test',
      modelId: 'test',
      supportedUrls: {},
      async doGenerate() {
        throw failure
      },
      async doStream() {
        throw failure
      }
    }
    const wrapped = wrapLanguageModel({
      model,
      middleware: createOverflowRecoveryMiddleware(async () => {
        throw new Error('summarizer failed')
      })
    })
    await expect(wrapped.doStream({ prompt: [] })).rejects.toBe(failure)
  })

  it('keeps the recovered context for later model steps', async () => {
    const seen: LanguageModelV3Prompt[] = []
    let compactions = 0
    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'test',
      modelId: 'test',
      supportedUrls: {},
      async doGenerate() {
        throw new Error('not used')
      },
      async doStream({ prompt }) {
        seen.push(prompt)
        if (seen.length === 1) throw overflow()
        return { stream: modelStream([{ type: 'text-start', id: 'a' }]) }
      }
    }
    const wrapped = wrapLanguageModel({
      model,
      middleware: createOverflowRecoveryMiddleware(async () => {
        compactions++
        return [{ role: 'user', content: [{ type: 'text', text: 'summary' }] }]
      })
    })
    const first: LanguageModelV3Prompt = [{ role: 'user', content: [{ type: 'text', text: 'old history' }] }]
    await collect((await wrapped.doStream({ prompt: first })).stream)
    const next: LanguageModelV3Prompt = [
      ...first,
      { role: 'assistant', content: [{ type: 'text', text: 'new response' }] }
    ]
    await collect((await wrapped.doStream({ prompt: next })).stream)
    expect(compactions).toBe(1)
    expect(JSON.stringify(seen[2])).toContain('summary')
    expect(JSON.stringify(seen[2])).toContain('new response')
    expect(JSON.stringify(seen[2])).not.toContain('old history')
  })

  it('does not start compaction after cancellation', async () => {
    const abort = new AbortController()
    let compactions = 0
    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'test',
      modelId: 'test',
      supportedUrls: {},
      async doGenerate() {
        throw overflow()
      },
      async doStream() {
        abort.abort()
        throw overflow()
      }
    }
    const wrapped = wrapLanguageModel({
      model,
      middleware: createOverflowRecoveryMiddleware(async () => {
        compactions++
        return []
      })
    })
    await expect(wrapped.doStream({ prompt: [], abortSignal: abort.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(compactions).toBe(0)
  })

  it('cancels an in-progress summary without retrying the model', async () => {
    const abort = new AbortController()
    let attempts = 0
    const started = Promise.withResolvers<void>()
    const model: LanguageModelV3 = {
      specificationVersion: 'v3',
      provider: 'test',
      modelId: 'test',
      supportedUrls: {},
      async doGenerate() {
        throw overflow()
      },
      async doStream() {
        attempts++
        throw overflow()
      }
    }
    const wrapped = wrapLanguageModel({
      model,
      middleware: createOverflowRecoveryMiddleware(async (_prompt, signal) => {
        started.resolve()
        return new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        )
      })
    })
    const outcome = Promise.resolve(wrapped.doStream({ prompt: [], abortSignal: abort.signal })).catch(
      (error: unknown) => error
    )
    await started.promise
    abort.abort()
    expect(await outcome).toMatchObject({ name: 'AbortError' })
    expect(attempts).toBe(1)
  })
})
