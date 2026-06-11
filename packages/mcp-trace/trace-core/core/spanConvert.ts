import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'

import type { SpanEntity } from '../types/config'

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
