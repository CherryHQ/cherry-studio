import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { describe, expect, it } from 'vitest'

import { getToolCallContext, type RequestContext } from '../context'

function makeRequest(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'req-1',
    abortSignal: new AbortController().signal,
    ...overrides
  }
}

function makeOptions(experimental_context: unknown): ToolExecutionOptions {
  return {
    toolCallId: 'call-1',
    messages: [],
    experimental_context
  } as ToolExecutionOptions
}

describe('getToolCallContext', () => {
  it('unwraps RequestContext threaded through experimental_context', () => {
    const request = makeRequest({ requestId: 'req-42', topicId: 't-1' })
    const ctx = getToolCallContext(makeOptions(request))
    expect(ctx.request).toBe(request)
    expect(ctx.toolCallId).toBe('call-1')
    expect(ctx.messages).toEqual([])
  })

  it('throws a wiring-pointing error when experimental_context is absent', () => {
    expect(() => getToolCallContext(makeOptions(undefined))).toThrow(/RequestContext/)
  })

  it('throws when experimental_context is the wrong shape', () => {
    expect(() => getToolCallContext(makeOptions({ foo: 'bar' }))).toThrow(/RequestContext/)
  })
})
