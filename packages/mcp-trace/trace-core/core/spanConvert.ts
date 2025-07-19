import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { ReadableSpan } from '@opentelemetry/sdk-trace-base'

import { SpanEntity } from '../types/config'

/**
 * convert ReadableSpan to SpanEntity
 * @param span ReadableSpan
 * @returns SpanEntity
 */
export function convertSpanToSpanEntity(span: ReadableSpan): SpanEntity {
  return {
    id: span.spanContext().spanId,
    traceId: span.spanContext().traceId,
    parentId: span.parentSpanContext?.spanId || '',
    name: span.name,
    startTime: span.startTime[0] * 1e3 + Math.floor(span.startTime[1] / 1e6), // 转为毫秒
    endTime: span.endTime ? span.endTime[0] * 1e3 + Math.floor(span.endTime[1] / 1e6) : undefined, // 转为毫秒
    attributes: { ...span.attributes },
    status: SpanStatusCode[span.status.code],
    events: span.events,
    kind: SpanKind[span.kind],
    links: span.links,
    modelName: span.attributes?.modelName
  } as SpanEntity
}
