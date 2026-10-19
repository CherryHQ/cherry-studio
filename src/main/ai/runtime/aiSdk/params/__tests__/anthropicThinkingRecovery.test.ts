import { APICallError, type LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

import {
  createAnthropicThinkingRecoveryMiddleware,
  excludeAnthropicThinking,
  isAnthropicThinkingBindingError
} from '../features/anthropicThinkingRecovery'
import { anthropicThinkingRecoveryFeature } from '../features/anthropicThinkingRecovery'
import type { RequestScope } from '../scope'

const diagnostic =
  'messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. Remove the block, or set `thinking.block_binding.prefix_mismatch_behavior` to "drop_block".'
const envelope = (message = diagnostic) => ({ type: 'error', error: { type: 'invalid_request_error', message } })
const failure = (message = diagnostic, statusCode = 400, data: unknown = envelope(message)) =>
  new APICallError({
    message,
    statusCode,
    data,
    url: 'https://test/messages',
    requestBodyValues: {},
    responseBody: JSON.stringify(data)
  })
const prompt: LanguageModelV3CallOptions['prompt'] = [
  { role: 'user', content: [{ type: 'text', text: 'edited prefix' }] },
  {
    role: 'assistant',
    content: [
      { type: 'reasoning', text: '', providerOptions: { anthropic: { signature: 'old' } } },
      { type: 'reasoning', text: '', providerOptions: { anthropic: { redactedData: 'redacted' } } },
      { type: 'text', text: 'kept' },
      { type: 'tool-call', toolCallId: 'call', toolName: 'lookup', input: { q: 'query' } }
    ]
  },
  {
    role: 'tool',
    content: [
      { type: 'tool-result', toolCallId: 'call', toolName: 'lookup', output: { type: 'text', value: 'result' } }
    ]
  }
]
function scope(maxRetries?: number): RequestScope {
  return {
    aiSdkProviderId: 'anthropic',
    provider: {
      id: 'custom',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: { [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://test' } }
    },
    model: { id: 'custom::haiku', modelId: 'haiku' },
    request: {
      requestOptions: maxRetries === undefined ? undefined : { maxRetries },
      anthropicThinkingRecovery: { records: [], record: vi.fn() }
    }
  } as unknown as RequestScope
}
const success = {
  content: [{ type: 'text' as const, text: 'answer' }],
  finishReason: { unified: 'stop' as const, raw: 'end_turn' },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 }
  },
  warnings: []
}

describe('Anthropic thinking recovery', () => {
  it('requires the exact structured 400 diagnostic, allowing whitespace, suffix and response-body fallback', () => {
    expect(isAnthropicThinkingBindingError(failure())).toBe(true)
    expect(isAnthropicThinkingBindingError(failure(diagnostic.replaceAll(' ', '\n') + ' Beta details.'))).toBe(true)
    const error = failure()
    Object.assign(error, { data: undefined })
    expect(isAnthropicThinkingBindingError(error)).toBe(true)
    for (const other of [
      failure('Invalid signature'),
      failure('Request too large'),
      failure('Invalid tool schema'),
      failure(diagnostic, 401),
      failure('Thinking belongs to another conversation'),
      failure(diagnostic, 400, { error: envelope().error }),
      new Error(diagnostic)
    ]) {
      expect(isAnthropicThinkingBindingError(other)).toBe(false)
    }
  })

  it('gates on exactly the resolved Anthropic adapters', () => {
    for (const id of ['anthropic', 'azure-anthropic', 'google-vertex-anthropic'] as const)
      expect(anthropicThinkingRecoveryFeature.applies!({ ...scope(), aiSdkProviderId: id })).toBe(true)
    expect(anthropicThinkingRecoveryFeature.applies!({ ...scope(), aiSdkProviderId: 'openai' })).toBe(false)
  })

  it('excludes only known credentials, preserving all other content and the original history', () => {
    const extra: LanguageModelV3CallOptions['prompt'] = [
      ...prompt,
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'new', providerOptions: { anthropic: { signature: 'new' } } },
          { type: 'reasoning', text: 'foreign', providerOptions: { google: { thoughtSignature: 'old' } } },
          {
            type: 'reasoning',
            text: 'shared',
            providerOptions: { anthropic: { signature: 'old' }, other: { signature: 'foreign' } }
          }
        ]
      }
    ]
    const original = structuredClone(extra)
    const repaired = excludeAnthropicThinking(extra, new Set(['old', 'redacted']))
    expect(repaired[1].content).toEqual((prompt[1].content as unknown[]).slice(2))
    expect(repaired[2]).toEqual(prompt[2])
    expect(repaired[3].content).toEqual([
      { type: 'reasoning', text: 'new', providerOptions: { anthropic: { signature: 'new' } } },
      { type: 'reasoning', text: 'foreign', providerOptions: { google: { thoughtSignature: 'old' } } }
    ])
    expect(extra).toEqual(original)
    expect(
      excludeAnthropicThinking(
        [
          {
            role: 'assistant',
            content: [{ type: 'reasoning', text: '', providerOptions: { anthropic: { signature: '' } } }]
          }
        ],
        new Set([''])
      )
    ).toEqual([])
  })

  it.each([{ signature: 'old' }, { redactedData: 'old' }])(
    'removes excluded Cherry-timed reasoning as a whole without mutating history: %j',
    (anthropic) => {
      const assistant: Extract<LanguageModelV3CallOptions['prompt'][number], { role: 'assistant' }> = {
        role: 'assistant',
        providerOptions: { other: { messageTag: 'kept' } },
        content: [
          {
            type: 'reasoning',
            text: 'completed thought',
            providerOptions: { cherry: { startedAt: 1000, thinkingMs: 50 }, anthropic }
          },
          { type: 'text', text: 'answer', providerOptions: { other: { tag: 'kept' } } }
        ]
      }
      const history: LanguageModelV3CallOptions['prompt'] = [prompt[0], assistant]
      const original = structuredClone(history)
      expect(excludeAnthropicThinking(history, new Set(['old']))).toEqual([
        history[0],
        { ...assistant, content: [assistant.content[1]] }
      ])
      expect(
        excludeAnthropicThinking([history[0], { ...assistant, content: [assistant.content[0]] }], new Set(['old']))
      ).toEqual([history[0]])
      expect(history).toEqual(original)
    }
  )

  it('repairs generation once and remembers exclusions for subsequent calls with newly generated thinking', async () => {
    const requestScope = scope()
    let attempts = 0
    const model = new MockLanguageModelV3({
      doGenerate: async (params) => {
        attempts++
        if (attempts === 1) throw failure()
        expect(params.prompt[1].content).toEqual((prompt[1].content as unknown[]).slice(2))
        return success
      }
    })
    const wrapped = wrapLanguageModel({ model, middleware: createAnthropicThinkingRecoveryMiddleware(requestScope) })
    expect((await wrapped.doGenerate({ prompt })).content).toEqual(success.content)
    await wrapped.doGenerate({ prompt })
    expect(attempts).toBe(3)
    expect(requestScope.request.anthropicThinkingRecovery?.records[0].identities).toEqual(['old', 'redacted'])
  })

  it('does not recursively repair a second failure', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        throw failure()
      }
    })
    const wrapped = wrapLanguageModel({ model, middleware: createAnthropicThinkingRecoveryMiddleware(scope()) })
    await expect(wrapped.doGenerate({ prompt })).rejects.toThrow(diagnostic)
    expect(model.doGenerateCalls).toHaveLength(2)
  })

  it.each(['zero', 'abort', 'no-blocks', 'unrelated'] as const)('does not repair %s', async (mode) => {
    const requestScope = scope(mode === 'zero' ? 0 : undefined)
    if (mode === 'abort') Object.assign(requestScope, { signal: AbortSignal.abort() })
    const error = mode === 'unrelated' ? failure('Invalid signature') : failure()
    const model = new MockLanguageModelV3({
      doStream: async () => {
        throw error
      }
    })
    const wrapped = wrapLanguageModel({ model, middleware: createAnthropicThinkingRecoveryMiddleware(requestScope) })
    await expect(wrapped.doStream({ prompt: mode === 'no-blocks' ? [prompt[0]] : prompt })).rejects.toBe(error)
    expect(model.doStreamCalls).toHaveLength(1)
  })

  it('does not restart a stream after content has been returned', async () => {
    const error = failure()
    let sentContent = false
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          pull(controller) {
            if (sentContent) controller.error(error)
            else {
              sentContent = true
              controller.enqueue({ type: 'text-delta', id: 'text', delta: 'partial' })
            }
          }
        })
      })
    })
    const wrapped = wrapLanguageModel({ model, middleware: createAnthropicThinkingRecoveryMiddleware(scope()) })
    const { stream } = await wrapped.doStream({ prompt })
    const reader = stream.getReader()
    expect((await reader.read()).value).toEqual({ type: 'text-delta', id: 'text', delta: 'partial' })
    await expect(reader.read()).rejects.toBe(error)
    expect(model.doStreamCalls).toHaveLength(1)
  })

  it('applies saved exclusions on the first zero-retry request and isolates endpoints', async () => {
    const requestScope = scope(0)
    const memory = requestScope.request.anthropicThinkingRecovery!
    memory.records = [
      {
        endpointKey: JSON.stringify(['custom', 'anthropic', ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'https://test']),
        identities: ['old']
      }
    ]
    const model = new MockLanguageModelV3({ doGenerate: async () => success })
    await wrapLanguageModel({ model, middleware: createAnthropicThinkingRecoveryMiddleware(requestScope) }).doGenerate({
      prompt
    })
    expect(model.doGenerateCalls[0].prompt[1].content).toEqual((prompt[1].content as unknown[]).slice(1))
    Object.assign(requestScope, {
      provider: {
        ...requestScope.provider,
        endpointConfigs: { [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://another-endpoint' } }
      }
    })
    await wrapLanguageModel({ model, middleware: createAnthropicThinkingRecoveryMiddleware(requestScope) }).doGenerate({
      prompt
    })
    expect(model.doGenerateCalls[1].prompt).toEqual(prompt)
  })
})
