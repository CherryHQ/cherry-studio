import { ROOT_CONTEXT, trace, TraceFlags } from '@opentelemetry/api'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { describe, expect, it } from 'vitest'

import { AdapterTracer } from '../adapterTracer'

const traceId = '12345678901234567890123456789012'
const parentContext = trace.setSpanContext(ROOT_CONTEXT, {
  traceId,
  spanId: '1234567890123456',
  traceFlags: TraceFlags.SAMPLED
})

describe('gateway SDK trace parenting', () => {
  it('joins the runtime trace after HTTP loses the active context and preserves nested SDK parents', () => {
    const provider = new BasicTracerProvider()
    const tracer = new AdapterTracer(provider.getTracer('test'), 'agent-session:test', 'model', parentContext)
    const root = tracer.startSpan('ai.streamText', {}, ROOT_CONTEXT)
    expect(root.spanContext().traceId).toBe(traceId)
    const active = trace.setSpan(ROOT_CONTEXT, root)
    const child = tracer.startSpan('ai.streamText.doStream', {}, active)
    expect(child.spanContext().traceId).toBe(traceId)
    expect('parentSpanContext' in child && child.parentSpanContext).toEqual(root.spanContext())
    tracer.startActiveSpan('ai.generateText', {}, ROOT_CONTEXT, (span) => {
      expect(span.spanContext().traceId).toBe(traceId)
      expect('parentSpanContext' in span && span.parentSpanContext).toEqual(trace.getSpanContext(parentContext))
      span.end()
    })
    child.end()
    root.end()
  })
})
