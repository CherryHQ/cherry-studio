import type { Span } from '@opentelemetry/api'
import { describe, expect, it } from 'vitest'

import { AiSdkSpanAdapter } from '../aiSdkSpanAdapter'

/** Minimal OTel-v2 ReadableSpan-shaped fake: the adapter reads these internal fields off the span. */
function fakeSpan(overrides: Record<string, unknown>): Span {
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
  const usage = (attrs: Record<string, unknown>) =>
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
