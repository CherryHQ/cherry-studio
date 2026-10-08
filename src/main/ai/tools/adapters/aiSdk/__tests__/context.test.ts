import type { ToolExecutionOptions } from 'ai'
import { describe, expect, it } from 'vitest'

import { getToolCallContext, type RequestContext } from '../context'

function makeRequest(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'req-1',
    abortSignal: new AbortController().signal,
    ...overrides
  }
}

function makeOptions(context: unknown): ToolExecutionOptions<unknown> {
  return {
    toolCallId: 'call-1',
    messages: [],
    context
  }
}

describe('getToolCallContext', () => {
  it.each(['request', 'call'] as const)('cancels host work when the %s signal aborts', (source) => {
    const request = new AbortController()
    const call = new AbortController()
    const reason = new Error('Cancelled')
    const context = getToolCallContext({
      ...makeOptions(makeRequest({ abortSignal: request.signal })),
      abortSignal: call.signal
    })
    ;({ request, call })[source].abort(reason)
    expect(() => context.abortSignal?.throwIfAborted()).toThrow(reason)
    expect({ request, call }[source === 'request' ? 'call' : 'request'].signal.aborted).toBe(false)
  })

  it('unwraps RequestContext threaded through context', () => {
    const request = makeRequest({ requestId: 'req-42', topicId: 't-1' })
    const ctx = getToolCallContext(makeOptions(request))
    expect(ctx.request).toBe(request)
    expect(ctx.toolCallId).toBe('call-1')
    expect(ctx.messages).toEqual([])
  })

  it('throws a wiring-pointing error when context is absent', () => {
    expect(() => getToolCallContext(makeOptions(undefined))).toThrow(/RequestContext/)
  })

  it('throws when context is the wrong shape', () => {
    expect(() => getToolCallContext(makeOptions({ foo: 'bar' }))).toThrow(/RequestContext/)
  })
})
