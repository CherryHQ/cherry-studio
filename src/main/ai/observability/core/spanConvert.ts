import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'

import type { SpanEntity } from '@shared/data/types/trace'

export type TraceSpanSnapshot = Pick<
  ReadableSpan,
  | 'spanContext'
  | 'parentSpanContext'
  | 'name'
  | 'kind'
  | 'startTime'
  | 'ended'
  | 'status'
  | 'attributes'
  | 'events'
  | 'links'
> &
  Partial<Pick<ReadableSpan, 'endTime'>>

/** Convert an SDK span snapshot into the persisted trace entity. */
export function convertSpanToSpanEntity(span: TraceSpanSnapshot): SpanEntity {
  return {
    id: span.spanContext().spanId,
    traceId: span.spanContext().traceId,
    parentId: span.parentSpanContext?.spanId || '',
    name: span.name,
    startTime: span.startTime[0] * 1e3 + Math.floor(span.startTime[1] / 1e6),
    endTime: span.ended && span.endTime ? span.endTime[0] * 1e3 + Math.floor(span.endTime[1] / 1e6) : null,
    // In-flight spans must stay non-evictable until SDK completion.
    isEnd: span.ended,
    attributes: { ...span.attributes },
    status: SpanStatusCode[span.status.code],
    events: span.events,
    kind: SpanKind[span.kind],
    links: span.links,
    modelName: typeof span.attributes.modelName === 'string' ? span.attributes.modelName : undefined
  }
}
