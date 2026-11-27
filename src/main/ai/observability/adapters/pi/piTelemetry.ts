import {
  NOOP_TELEMETRY_CONTEXT,
  type SpanAttributes,
  type SpanStatus,
  type TelemetryContext,
  type TelemetryPropagation,
  type TelemetrySpan
} from '@earendil-works/pi-telemetry'
import { ROOT_CONTEXT, SpanStatusCode, TraceFlags, trace, type Span, type Tracer } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import * as z from 'zod'

import { loggerService } from '@logger'

import { TRACER_NAME } from '../../constants'
import type { AgentRuntimeTraceContext } from '../../core/AiTurnTrace'
import { convertSpanToSpanEntity } from '../../core/spanConvert'
import { observabilitySinks } from '../../sinks/ObservabilitySinkRegistry'

const logger = loggerService.withContext('PiTelemetry')
const parents = new WeakMap<TelemetryContext, () => AgentRuntimeTraceContext | undefined>()
const propagator = new W3CTraceContextPropagator()
const carrierMeta = z.object({
  'cherry.topic_id': z.string().min(1),
  'cherry.session_id': z.string().min(1),
  'cherry.turn_id': z.string().min(1),
  'cherry.model_name': z.string().optional()
})

/** The explicit native parent, frozen for a gateway request or recovered task. */
export function getPiTraceContext(context: TelemetryContext | undefined): AgentRuntimeTraceContext | undefined {
  return context && parents.get(context)?.()
}

function otelParent(parent: AgentRuntimeTraceContext) {
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: parent.traceId,
    spanId: parent.rootSpanId,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: true
  })
}

function attributes(values: SpanAttributes = {}) {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, typeof value === 'object' ? value.slice() : value])
  )
}

/** Pi owns instrumentation; this adapter owns OTel settlement, propagation and local projection. */
export function createPiTelemetry(
  options: {
    getParent: (attributes: SpanAttributes) => AgentRuntimeTraceContext | undefined
    isEnabled: () => boolean
  },
  tracer: Tracer = trace.getTracer(TRACER_NAME)
): TelemetrySpan {
  const { getParent, isEnabled } = options
  const propagation: TelemetryPropagation = {
    inject(context) {
      const parent = getPiTraceContext(context)
      if (!parent) return undefined
      const carrier: Record<string, string> = {
        'cherry.topic_id': parent.topicId,
        'cherry.session_id': parent.sessionId,
        'cherry.turn_id': parent.turnId,
        ...(parent.modelName ? { 'cherry.model_name': parent.modelName } : {})
      }
      propagator.inject(otelParent(parent), carrier, { set: (target, key, value) => (target[key] = value) })
      return carrier
    },
    extract(carrier) {
      const meta = carrierMeta.safeParse(carrier)
      if (!meta.success || !carrier) return root
      const parent = trace.getSpanContext(
        propagator.extract(ROOT_CONTEXT, carrier, {
          keys: (value) => Object.keys(value),
          get: (value, key) => value[key]
        })
      )
      if (!parent) return root
      return makeContext({
        traceId: parent.traceId,
        rootSpanId: parent.spanId,
        topicId: meta.data['cherry.topic_id'],
        sessionId: meta.data['cherry.session_id'],
        turnId: meta.data['cherry.turn_id'],
        modelName: meta.data['cherry.model_name']
      })
    }
  }

  function makeContext(parent?: AgentRuntimeTraceContext): TelemetrySpan {
    const context: TelemetrySpan = {
      ...NOOP_TELEMETRY_CONTEXT,
      propagation,
      async startSpan(options, callback) {
        if (!isEnabled()) return NOOP_TELEMETRY_CONTEXT.startSpan(options, callback)
        const owner = parent ?? getParent(options.attributes ?? {})
        if (!owner) return NOOP_TELEMETRY_CONTEXT.startSpan(options, callback)
        // Model calls are already instrumented by the gateway's AI SDK and HTTP layers.
        if (options.name === 'pi.ai.request' || options.name === 'pi.ai.poll') return callback(makeContext(owner))
        const span = tracer.startSpan(
          options.name,
          {
            attributes: {
              ...attributes(options.attributes),
              'trace.topicId': owner.topicId,
              'trace.modelName': owner.modelName,
              'cs.agent_session_id': owner.sessionId,
              'cs.agent_turn_id': owner.turnId
            }
          },
          otelParent(owner)
        )
        if (!span.isRecording()) return callback(makeContext(owner))
        const child = makeContext({ ...owner, rootSpanId: span.spanContext().spanId })
        let settled = false
        let status: SpanStatus | undefined
        child.addLink = (link) => {
          const target = getPiTraceContext(link.context)
          if (!settled && target) {
            const linked = trace.getSpanContext(otelParent(target))!
            span.addLink({ context: linked, attributes: attributes(link.attributes) })
          }
        }
        child.addEvent = (name, values) => {
          if (!settled) span.addEvent(name, attributes(values))
        }
        child.setAttributes = (values) => {
          if (!settled) span.setAttributes(attributes(values))
        }
        child.setStatus = (value) => {
          if (settled) return
          status = value
        }
        for (const link of options.links ?? []) child.addLink(link)
        try {
          const result = await callback(child)
          if (!status) child.setStatus({ status: 'ok' })
          return result
        } catch (error) {
          if (!status) {
            child.setStatus({
              status: 'error',
              error: { name: error instanceof Error ? error.name : 'Error', message: String(error) }
            })
          }
          throw error
        } finally {
          settled = true
          span.setStatus({
            code: status?.status === 'error' ? SpanStatusCode.ERROR : SpanStatusCode.OK,
            ...(status?.status === 'error' && { message: status.error?.message })
          })
          if (status?.status === 'error' && status.error) {
            span.setAttributes({ 'error.type': status.error.name, 'error.message': status.error.message })
          }
          span.end()
          if ('attributes' in span && 'startTime' in span) {
            try {
              const entity = convertSpanToSpanEntity(span as Span & ReadableSpan)
              const values = entity.attributes ?? {}
              const input = options.attributes ?? {}
              entity.topicId = owner.topicId
              entity.modelName = owner.modelName
              entity.attributes = {
                ...values,
                inputs: JSON.stringify(input),
                outputs: JSON.stringify(
                  Object.fromEntries(
                    Object.entries(values).filter(
                      ([key]) => !Object.hasOwn(input, key) && !key.startsWith('trace.') && !key.startsWith('cs.')
                    )
                  )
                ),
                tags: typeof values['tool.name'] === 'string' ? 'Tool' : 'Pi'
              }
              observabilitySinks.writeSpanEntity(entity)
            } catch (error) {
              logger.warn('Failed to project native Pi telemetry', { error })
            }
          }
        }
      }
    }
    parents.set(context, () => parent ?? getParent({}))
    return context
  }

  const root = makeContext()
  return root
}
