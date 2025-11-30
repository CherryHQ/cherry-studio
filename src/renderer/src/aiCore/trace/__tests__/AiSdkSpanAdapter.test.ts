import type { Span } from '@opentelemetry/api'
import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { describe, expect, it, vi } from 'vitest'

import { AiSdkSpanAdapter } from '../AiSdkSpanAdapter'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

describe('AiSdkSpanAdapter', () => {
  const createMockSpan = (attributes: Record<string, unknown>): Span => {
    const span = {
      spanContext: () => ({
        traceId: 'trace-id',
        spanId: 'span-id'
      }),
      _attributes: attributes,
      _events: [],
      name: 'test span',
      status: { code: SpanStatusCode.OK },
      kind: SpanKind.CLIENT,
      startTime: [0, 0] as [number, number],
      endTime: [0, 1] as [number, number],
      ended: true,
      parentSpanId: '',
      links: []
    }
    return span as unknown as Span
  }

  it('maps prompt and completion usage tokens to the correct fields', () => {
    const attributes = {
      'ai.usage.promptTokens': 321,
      'ai.usage.completionTokens': 654
    }

    const span = createMockSpan(attributes)
    const result = AiSdkSpanAdapter.convertToSpanEntity({ span })

    expect(result.usage).toBeDefined()
    expect(result.usage?.prompt_tokens).toBe(321)
    expect(result.usage?.completion_tokens).toBe(654)
    expect(result.usage?.total_tokens).toBe(975)
  })
})
