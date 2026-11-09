import { ROOT_CONTEXT, trace, TraceFlags } from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { expect, it } from 'vitest'

import { withoutDiagnostics } from '@main/core/logger/diagnosticScope'

import { buildTelemetry } from '../../runtime/aiSdk/params/buildTelemetry'
import type { RequestScope } from '../../runtime/aiSdk/params/scope'
import { TraceMethod } from '../core/traceMethod'
import { diagnosticSampler } from '../runtime/diagnosticSampler'

it('preserves the decorated async contract when diagnostics are suppressed', async () => {
  const target = {
    run: () => {
      throw new Error('private failure')
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(target, 'run')!
  TraceMethod({})(target, 'run', descriptor)
  await expect(withoutDiagnostics(() => descriptor.value())).rejects.toThrow('private failure')
})

it('disables SDK input/output capture without changing the developer preference', () => {
  MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', true)
  const scope = {
    requestContext: { topicId: 'topic', requestId: 'request' },
    model: { id: 'model' },
    sdkConfig: { providerId: 'provider', modelId: 'model' }
  } as RequestScope
  try {
    expect(withoutDiagnostics(() => buildTelemetry(scope))).toBeUndefined()
    expect(buildTelemetry(scope)).toMatchObject({ isEnabled: true, recordInputs: true, recordOutputs: true })
  } finally {
    MockMainPreferenceServiceUtils.resetMocks()
  }
})

it('never exports temporary spans, including children of sampled ordinary requests', async () => {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    sampler: diagnosticSampler,
    spanProcessors: [new SimpleSpanProcessor(exporter)]
  })
  const tracer = provider.getTracer('privacy')
  const parent = trace.setSpanContext(ROOT_CONTEXT, {
    traceId: '12345678901234567890123456789012',
    spanId: '1234567890123456',
    traceFlags: TraceFlags.SAMPLED
  })
  try {
    await Promise.all([
      withoutDiagnostics(async () => {
        await Promise.resolve()
        const span = tracer.startSpan('private', {}, parent)
        span.setAttribute('inputs', 'private prompt')
        span.recordException(new Error('private response'))
        span.end()
      }),
      (async () => {
        await Promise.resolve()
        const span = tracer.startSpan('ordinary')
        span.setAttribute('inputs', 'ordinary prompt')
        span.end()
      })()
    ])
    const spans = exporter.getFinishedSpans()
    expect(spans.map((span) => span.name)).toEqual(['ordinary'])
    expect(spans[0].attributes.inputs).toBe('ordinary prompt')
  } finally {
    await provider.shutdown()
  }
})
