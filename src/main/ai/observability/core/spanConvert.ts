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
  | 'endTime'
  | 'ended'
  | 'status'
  | 'attributes'
  | 'events'
  | 'links'
>

/** Convert an SDK span snapshot into the persisted trace entity. */
export function convertSpanToSpanEntity(span: TraceSpanSnapshot): SpanEntity {
  return {
    id: span.spanContext().spanId,
    traceId: span.spanContext().traceId,
    parentId: span.parentSpanContext?.spanId || '',
    name: span.name,
    // A non-recording span (no SDK provider registered) carries no startTime;
    // guard like endTime below instead of throwing on `undefined[0]`.
    startTime: span.startTime ? span.startTime[0] * 1e3 + Math.floor(span.startTime[1] / 1e6) : undefined, // 转为毫秒
    endTime: span.endTime ? span.endTime[0] * 1e3 + Math.floor(span.endTime[1] / 1e6) : undefined, // 转为毫秒
    // `isEnd` is required by SpanEntity but was previously omitted (the `as SpanEntity` cast hid it),
    // so spans persisted via this converter (e.g. the AiTurnTrace end-patch → writeSpanEntity path)
    // landed with `isEnd: undefined` and their traces were never evictable. Derive it from the OTel
    // `ended` flag; callers that build in-flight spans still override it (e.g. createSpan → false).
    isEnd: span.ended,
    attributes: { ...span.attributes },
    status: SpanStatusCode[span.status.code],
    events: span.events,
    kind: SpanKind[span.kind],
    links: span.links,
    modelName: span.attributes?.modelName
  } as SpanEntity
}
