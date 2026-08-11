import type { SpanEntity } from '@mcp-trace/trace-core'
import { trace } from '@opentelemetry/api'
import { AlwaysOnSampler, BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }))
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), info: vi.fn(), warn: warnSpy, error: vi.fn() })
  }
}))

import type { ObservabilitySink } from '../../sinks/ObservabilitySink'
import { observabilitySinks } from '../../sinks/ObservabilitySinkRegistry'
import { startAiTurnTrace } from '../AiTurnTrace'

// Real OTel spans (so end() stamps a real endTime/status) + a fake sink capturing what the
// end-patch persists. `startTraceRootSpan` monkey-patches `span.end` to convert and write the
// span AFTER the original end runs, so the persisted entity must carry the status set by the
// handle's end() — not an UNSET span captured before the status was applied.
describe('startAiTurnTrace end-patch persistence', () => {
  const captured: SpanEntity[] = []
  const fakeSink: ObservabilitySink = {
    id: 'ai-turn-trace-test-sink',
    writeSpanEntity: (span) => {
      captured.push(span)
    }
  }
  const tracer = new BasicTracerProvider({ sampler: new AlwaysOnSampler() }).getTracer('ai-turn-trace-test')

  beforeEach(() => {
    captured.length = 0
    observabilitySinks.register(fakeSink)
  })

  it('persists the ended root span with the OK status and topic/model meta', () => {
    const handle = startAiTurnTrace('ai.turn', {}, { topicId: 'topic-ok', modelName: 'model-x' }, tracer)
    handle.end('ok')

    const persisted = captured.filter((s) => s.topicId === 'topic-ok')
    expect(persisted).toHaveLength(1)
    expect(persisted[0].name).toBe('ai.turn')
    expect(persisted[0].status).toBe('OK')
    expect(persisted[0].modelName).toBe('model-x')
    expect(typeof persisted[0].endTime).toBe('number')
  })

  it('persists the ERROR status when the turn ends with an error', () => {
    const handle = startAiTurnTrace('ai.turn', {}, { topicId: 'topic-err' }, tracer)
    handle.end('error', new Error('boom'))

    const persisted = captured.filter((s) => s.topicId === 'topic-err')
    expect(persisted).toHaveLength(1)
    expect(persisted[0].status).toBe('ERROR')
  })

  it('a non-recording span (no provider — developer mode off) ends without throwing or persisting', () => {
    // trace.getTracer with no registered provider returns the API no-op tracer,
    // whose spans are NonRecordingSpan (no startTime). This is every turn when
    // developer mode is off — the end-patch must skip conversion entirely
    // instead of throwing "Cannot read properties of undefined (reading '0')".
    const noopTracer = trace.getTracer('ai-turn-trace-noop-test')
    warnSpy.mockClear()
    const handle = startAiTurnTrace('ai.turn', {}, { topicId: 'topic-noop' }, noopTracer)

    expect(() => handle.end('ok')).not.toThrow()
    expect(captured.filter((s) => s.topicId === 'topic-noop')).toHaveLength(0)
    // The old code converted unconditionally, threw, and warned every turn.
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Failed to persist root span'), expect.anything())
  })
})
