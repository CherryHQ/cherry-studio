import { loggerService } from '@logger'
import { convertSpanToSpanEntity } from '@mcp-trace/trace-core/core/spanConvert'
import type { Attributes, Span, SpanOptions, Tracer } from '@opentelemetry/api'
import { ROOT_CONTEXT, SpanStatusCode, trace, TraceFlags } from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import { deriveRootSpanId } from '@shared/data/types/trace'

import { TRACER_NAME } from '../constants'
import { observabilitySinks } from '../sinks/ObservabilitySinkRegistry'

// `deriveRootSpanId` now lives in `@shared/data/types/trace` so the renderer trace viewer can
// share it; re-exported here for existing main-side import paths.
export { deriveRootSpanId }

const logger = loggerService.withContext('AiTurnTrace')

export interface AiTurnTraceMeta {
  topicId: string
  modelName?: string
  sessionId?: string
  turnId?: string
}

export interface AgentRuntimeTraceContext {
  topicId: string
  traceId: string
  modelName?: string
  sessionId: string
  turnId: string
  rootSpanId: string
}

export interface AiTurnTraceHandle {
  traceId: string
  rootSpanId: string
  rootSpan: Span
  addEvent(name: string, attributes?: Attributes): void
  end(status?: 'ok' | 'aborted' | 'error', error?: Error): void
  toAgentRuntimeTraceContext(): AgentRuntimeTraceContext | undefined
}

/** Root turn span (no parent) — the container's first activity. */
export function startAiTurnTrace(
  name: string,
  options: SpanOptions,
  meta: AiTurnTraceMeta,
  tracer: Tracer = trace.getTracer(TRACER_NAME)
): AiTurnTraceHandle {
  return buildTurnHandle(startTraceRootSpan(tracer, name, options, meta), meta)
}

/**
 * Child turn span under a container trace's synthetic root. Inherits the container
 * traceId, so every turn of a topic/session lands in one trace tree. The root span id
 * is derived from `traceId` internally (callers pass only the traceId).
 */
export function startAiChildTurnSpan(
  name: string,
  options: SpanOptions,
  meta: AiTurnTraceMeta,
  traceId: string,
  tracer: Tracer = trace.getTracer(TRACER_NAME)
): AiTurnTraceHandle {
  return buildTurnHandle(startTraceRootSpan(tracer, name, options, meta, traceId), meta)
}

function buildTurnHandle(rootSpan: Span, meta: AiTurnTraceMeta): AiTurnTraceHandle {
  const spanContext = rootSpan.spanContext()
  observabilitySinks.registerTraceMeta(spanContext.traceId, { topicId: meta.topicId, modelName: meta.modelName })

  return {
    traceId: spanContext.traceId,
    rootSpanId: spanContext.spanId,
    rootSpan,
    addEvent(eventName, attributes) {
      rootSpan.addEvent(eventName, attributes)
    },
    end(status = 'ok', error) {
      if (status === 'ok') {
        rootSpan.setStatus({ code: SpanStatusCode.OK })
      } else if (status === 'aborted') {
        rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'aborted' })
      } else {
        rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: error?.message ?? 'error' })
        if (error) rootSpan.recordException(error)
      }
      rootSpan.end()
    },
    toAgentRuntimeTraceContext() {
      if (!meta.sessionId || !meta.turnId) return undefined
      return {
        topicId: meta.topicId,
        traceId: spanContext.traceId,
        rootSpanId: spanContext.spanId,
        sessionId: meta.sessionId,
        turnId: meta.turnId,
        modelName: meta.modelName
      }
    }
  }
}

export function startTraceRootSpan(
  tracer: Tracer,
  name: string,
  options: SpanOptions,
  meta: AiTurnTraceMeta,
  parentTraceId?: string
): Span {
  const span = parentTraceId
    ? tracer.startSpan(
        name,
        options,
        trace.setSpanContext(ROOT_CONTEXT, {
          traceId: parentTraceId,
          spanId: deriveRootSpanId(parentTraceId),
          traceFlags: TraceFlags.SAMPLED,
          isRemote: true
        })
      )
    : tracer.startSpan(name, options)
  if (meta.topicId) span.setAttribute('trace.topicId', meta.topicId)
  if (meta.modelName) span.setAttribute('trace.modelName', meta.modelName)

  const originalEnd = span.end.bind(span)
  span.end = (endTime?: any) => {
    originalEnd(endTime)
    try {
      const spanEntity = convertSpanToSpanEntity(span as unknown as ReadableSpan)
      observabilitySinks.writeSpanEntity({
        ...spanEntity,
        topicId: meta.topicId,
        modelName: meta.modelName,
        attributes: {
          ...spanEntity.attributes,
          ...(meta.modelName ? { modelName: meta.modelName } : {})
        }
      })
    } catch (error) {
      logger.warn(`Failed to persist root span ${name}`, error as Error)
    }
  }

  return span
}
