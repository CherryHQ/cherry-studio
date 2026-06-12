import type { SpanEntity } from '@mcp-trace/trace-core'
import { AlwaysOnSampler, BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { beforeEach, describe, expect, it } from 'vitest'

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
})
