import type { Attributes, Span, SpanContext } from '@opentelemetry/api'
import { describe, expect, it } from 'vitest'

import { AiSdkSpanAdapter } from '../aiSdkSpanAdapter'

/** Minimal OTel-v2 ReadableSpan-shaped fake: the adapter reads these internal fields off the span. */
function fakeSpan(overrides: { _attributes?: Attributes; parentSpanContext?: Pick<SpanContext, 'spanId'> }): Span {
  return {
    spanContext: () => ({ spanId: 'span-1', traceId: 'trace-1', traceFlags: 1 }),
    name: 'ai.streamText',
    _attributes: { 'ai.operationId': 'ai.streamText' },
    startTime: [1, 0],
    endTime: [2, 0],
    ended: true,
    ...overrides
  } as unknown as Span
}

describe('AiSdkSpanAdapter.convertToSpanEntity — parent linkage', () => {
  // REGRESSION: OTel SDK v2 renamed ReadableSpan.parentSpanId → parentSpanContext. Reading only the
  // removed field left every AI SDK span with an empty parent, so ai.streamText & co. rendered as
  // trace roots instead of nesting under ai.turn.
  it('reads the parent from OTel v2 parentSpanContext.spanId', () => {
    const entity = AiSdkSpanAdapter.convertToSpanEntity({
      span: fakeSpan({ parentSpanContext: { spanId: 'chat-turn-span' } }),
      topicId: 'topic-1'
    })
    expect(entity.parentId).toBe('chat-turn-span')
    expect(entity.id).toBe('span-1')
  })

  it('falls back to the injected trace.parentSpanId attribute when parentSpanContext is absent', () => {
    const entity = AiSdkSpanAdapter.convertToSpanEntity({
      span: fakeSpan({ _attributes: { 'ai.operationId': 'ai.streamText', 'trace.parentSpanId': 'attr-parent' } }),
      topicId: 'topic-1'
    })
    expect(entity.parentId).toBe('attr-parent')
  })

  it('yields an empty parent (root) when the span has no parent', () => {
    const entity = AiSdkSpanAdapter.convertToSpanEntity({ span: fakeSpan({}), topicId: 'topic-1' })
    expect(entity.parentId).toBe('')
  })
})

describe('AiSdkSpanAdapter.convertToSpanEntity — token usage (AI SDK v6 keys)', () => {
  const usage = (attrs: Attributes) =>
    AiSdkSpanAdapter.convertToSpanEntity({
      span: fakeSpan({ _attributes: { 'ai.operationId': 'ai.streamText', ...attrs } }),
      topicId: 't'
    }).usage

  it('reads the v6 primary inputTokens/outputTokens names', () => {
    expect(usage({ 'ai.usage.inputTokens': 100, 'ai.usage.outputTokens': 20 })).toMatchObject({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120
    })
  })

  it('still reads the legacy promptTokens/completionTokens aliases', () => {
    expect(usage({ 'ai.usage.promptTokens': 5, 'ai.usage.completionTokens': 7 })).toMatchObject({
      prompt_tokens: 5,
      completion_tokens: 7
    })
  })

  it('prefers the SDK-reported totalTokens over the computed sum', () => {
    expect(
      usage({ 'ai.usage.inputTokens': 10, 'ai.usage.outputTokens': 4, 'ai.usage.totalTokens': 99 })?.total_tokens
    ).toBe(99)
  })

  it('captures cached input tokens and reasoning tokens', () => {
    const u = usage({
      'ai.usage.inputTokens': 100,
      'ai.usage.outputTokens': 50,
      'ai.usage.cachedInputTokens': 80,
      'ai.usage.reasoningTokens': 30
    })
    expect(u?.prompt_tokens_details?.cached_tokens).toBe(80)
    expect(u?.completion_tokens_details?.reasoning_tokens).toBe(30)
  })

  it('maps the single embedding token count to prompt_tokens', () => {
    expect(usage({ 'ai.usage.tokens': 42 })).toMatchObject({ prompt_tokens: 42, total_tokens: 42 })
  })

  it('returns undefined when the span has no usage (e.g. tool calls)', () => {
    expect(usage({ 'ai.toolCall.name': 'x' })).toBeUndefined()
  })
})

describe('AiSdkSpanAdapter.convertToSpanEntity — attributes', () => {
  it('preserves custom attribute keys without changing the output prototype', () => {
    const attributes: Attributes = Object.freeze({
      'ai.operationId': 'ai.streamText',
      ['__proto__']: ['custom value'],
      constructor: 'custom constructor',
      'ai.prompt': 'prompt payload'
    })

    const entity = AiSdkSpanAdapter.convertToSpanEntity({ span: fakeSpan({ _attributes: attributes }) })

    expect(Object.getOwnPropertyDescriptor(entity.attributes ?? {}, '__proto__')?.value).toEqual(['custom value'])
    expect(entity.attributes?.constructor).toBe('custom constructor')
    expect(Object.getPrototypeOf(entity.attributes)).toBe(Object.prototype)
    expect(Object.hasOwn(entity.attributes ?? {}, 'ai.prompt')).toBe(false)
    expect(entity.attributes?.inputs).toEqual({ prompt: 'prompt payload' })
    expect(Object.getOwnPropertyDescriptor(attributes, '__proto__')?.value).toEqual(['custom value'])
  })
})

describe('AiSdkSpanAdapter.convertToSpanEntity — decoded payloads', () => {
  it('retains nested provider inputs and tool-call outputs for trace display', () => {
    const messages = [{ role: 'user', content: [{ type: 'text', text: 'Find the item' }] }]
    const tools = [{ name: 'lookup', parameters: { type: 'object', properties: { id: { type: 'number' } } } }]
    const toolCalls = [{ toolCallId: 't1', toolName: 'lookup', input: { filters: [null, true, { id: 7 }] } }]
    const entity = AiSdkSpanAdapter.convertToSpanEntity({
      span: fakeSpan({
        _attributes: {
          'ai.operationId': 'ai.streamText.doStream',
          'ai.prompt.messages': JSON.stringify(messages),
          'ai.prompt.tools': JSON.stringify(tools),
          'ai.prompt.toolChoice': 'not JSON',
          'ai.response.text': 'An answer',
          'ai.response.toolCalls': JSON.stringify(toolCalls)
        }
      })
    })

    expect(entity.attributes?.inputs).toEqual({ messages, tools, toolChoice: 'not JSON' })
    expect(entity.attributes?.outputs).toEqual({ text: 'An answer', toolCalls })
  })

  it.each([
    { raw: 'null', expected: null },
    { raw: '[1,true,null,{"nested":["x"]}]', expected: [1, true, null, { nested: ['x'] }] },
    { raw: '7', expected: 7 },
    { raw: 'ordinary text', expected: 'ordinary text' }
  ])('retains generic JSON values or the original non-JSON text: $raw', ({ raw, expected }) => {
    const entity = AiSdkSpanAdapter.convertToSpanEntity({
      span: fakeSpan({ _attributes: { inputs: raw, outputs: raw } })
    })

    expect(entity.attributes?.inputs).toEqual(expected)
    expect(entity.attributes?.outputs).toEqual(expected)
  })
})
