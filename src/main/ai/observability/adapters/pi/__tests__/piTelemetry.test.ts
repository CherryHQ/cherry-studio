import type { TelemetrySpan } from '@earendil-works/pi-telemetry'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { beforeEach, describe, expect, it } from 'vitest'

import type { SpanEntity } from '@shared/data/types/trace'

import type { AgentRuntimeTraceContext } from '../../../core/AiTurnTrace'
import { observabilitySinks } from '../../../sinks/ObservabilitySinkRegistry'
import { createPiTelemetry, getPiTraceContext } from '../piTelemetry'

const owner: AgentRuntimeTraceContext = {
  topicId: 'agent-session:one',
  sessionId: 'one',
  turnId: 'turn-one',
  traceId: '11111111111111111111111111111111',
  rootSpanId: '2222222222222222'
}
const tracer = new BasicTracerProvider().getTracer('pi-telemetry-test')
const captured: SpanEntity[] = []
beforeEach(() => {
  captured.length = 0
  observabilitySinks.register({
    id: 'pi-telemetry-test',
    writeSpanEntity: (span) => {
      captured.push(span)
    }
  })
})
const bridge = (parent = owner, enabled = true) =>
  createPiTelemetry({ getParent: () => parent, isEnabled: () => enabled }, tracer)

describe('Pi native telemetry adapter', () => {
  // Duplicate Pi model instrumentation would double usage in the trace and hide the true SDK parent.
  it('suppresses Pi model spans without losing the native parent or consuming results', async () => {
    const telemetry = bridge()
    const result = await telemetry.startSpan(
      { name: 'pi.durable.phase', attributes: { 'task.id': 1 } },
      async (phase) => {
        for (const name of ['pi.ai.request', 'pi.ai.poll']) {
          await phase.startSpan({ name }, async (model) => {
            expect(getPiTraceContext(model)).toEqual(getPiTraceContext(phase))
            model.setAttributes({ 'gen_ai.usage.input_tokens': 100 })
            await model.startSpan({ name: 'native-child' }, () => undefined)
          })
        }
        return 'answer'
      }
    )
    expect(result).toBe('answer')
    expect(captured.map((span) => span.name)).toEqual(['native-child', 'native-child', 'pi.durable.phase'])
    const phase = captured.at(-1)!
    expect(captured.slice(0, 2).map((span) => span.parentId)).toEqual([phase.id, phase.id])
    expect(phase.attributes).not.toHaveProperty('gen_ai.usage.input_tokens')
    expect(captured.every((span) => span.usage === undefined)).toBe(true)
  })

  // A recovered task must not attach to whichever session is active after reopening the backend.
  it('round-trips native carriers and links while freezing the original session', async () => {
    const first = bridge()
    let carrier: Record<string, string> | undefined
    await first.startSpan({ name: 'pi.durable.submit' }, (span) => {
      carrier = span.propagation!.inject(span)
    })
    const submitted = captured[0]
    const secondOwner = {
      ...owner,
      sessionId: 'two',
      topicId: 'agent-session:two',
      traceId: '33333333333333333333333333333333'
    }
    const reopened = bridge(secondOwner)
    const recovered = reopened.propagation!.extract(JSON.parse(JSON.stringify(carrier)))
    await recovered.startSpan({ name: 'pi.durable.phase', attributes: { resumed: true } }, (span) => {
      span.addLink({ context: first.propagation!.extract(carrier), attributes: { reason: 'resume' } })
      span.setAttributes({ outcome: 'done', 'tool.name': 'bash' })
      span.addEvent('pi.durable.entry', { 'entry.id': 9, 'entry.kind': 'toolResult' })
    })
    await reopened.startSpan({ name: 'sibling' }, () => undefined)
    const phase = captured[1]
    expect(phase).toMatchObject({
      traceId: owner.traceId,
      topicId: owner.topicId,
      parentId: submitted.id,
      status: 'OK',
      isEnd: true
    })
    expect(phase.links).toMatchObject([
      { context: { traceId: owner.traceId, spanId: submitted.id }, attributes: { reason: 'resume' } }
    ])
    expect(phase.events).toMatchObject([{ name: 'pi.durable.entry', attributes: { 'entry.id': 9 } }])
    expect(JSON.parse(String(phase.attributes?.inputs))).toEqual({ resumed: true })
    expect(JSON.parse(String(phase.attributes?.outputs))).toEqual({ outcome: 'done', 'tool.name': 'bash' })
    expect(captured[2]).toMatchObject({ traceId: secondOwner.traceId, topicId: secondOwner.topicId })
  })

  it('preserves callback errors and ignores updates after settlement', async () => {
    const error = new Error('native failure')
    let retained: TelemetrySpan | undefined
    await expect(
      bridge().startSpan({ name: 'pi.durable.phase' }, (span) => {
        retained = span
        throw error
      })
    ).rejects.toBe(error)
    retained!.setAttributes({ outcome: 'late' })
    retained!.addEvent('late')
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({ status: 'ERROR', isEnd: true, attributes: { 'error.type': 'Error' } })
    expect(captured[0].attributes).not.toHaveProperty('outcome')
    expect(captured[0].events).toEqual([])
  })

  it('respects native status for a handled cancellation', async () => {
    await bridge().startSpan({ name: 'pi.durable.phase' }, (span) => {
      span.setStatus({ status: 'error', error: { name: 'Error', message: 'retry' } })
      span.setStatus({ status: 'ok' })
      span.setAttributes({ outcome: 'aborted' })
    })
    expect(captured[0]).toMatchObject({ status: 'OK', attributes: { outcome: 'aborted' } })
  })

  it('honors a final error after an earlier OK status', async () => {
    await bridge().startSpan({ name: 'pi.durable.phase' }, (span) => {
      span.setStatus({ status: 'ok' })
      span.setStatus({ status: 'error', error: { name: 'TaskFailed', message: 'commit failed' } })
    })
    expect(captured[0]).toMatchObject({
      status: 'ERROR',
      attributes: { 'error.type': 'TaskFailed', 'error.message': 'commit failed' }
    })
  })

  it('records nothing when disabled, even with a previously persisted carrier', async () => {
    const carrier = bridge().propagation!.inject(bridge())
    const disabled = bridge(owner, false)
    const result = await disabled.propagation!.extract(carrier).startSpan({ name: 'pi.durable.phase' }, () => 42)
    expect(result).toBe(42)
    expect(captured).toEqual([])
  })

  it('does not assign an unowned task to another session', async () => {
    const telemetry = createPiTelemetry({ getParent: () => undefined, isEnabled: () => true }, tracer)
    const result = await telemetry
      .propagation!.extract({ traceparent: 'invalid' })
      .startSpan({ name: 'pi.durable.phase' }, () => 'untraced')
    expect(result).toBe('untraced')
    expect(captured).toEqual([])
  })
})
