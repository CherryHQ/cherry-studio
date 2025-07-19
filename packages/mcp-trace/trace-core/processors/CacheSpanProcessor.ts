import { Context, trace } from '@opentelemetry/api'
import { BatchSpanProcessor, BufferConfig, ReadableSpan, Span, SpanExporter } from '@opentelemetry/sdk-trace-base'

import { TraceCache } from '../core/traceCache'

export class CacheBatchSpanProcessor extends BatchSpanProcessor {
  private cache: TraceCache

  constructor(_exporter: SpanExporter, cache: TraceCache, config?: BufferConfig) {
    super(_exporter, config)
    this.cache = cache
  }

  override onEnd(span: ReadableSpan): void {
    super.onEnd(span)
    this.cache.endSpan(span)
  }

  override onStart(span: Span, parentContext: Context): void {
    super.onStart(span, parentContext)
    this.cache.createSpan({
      name: span.name,
      kind: span.kind,
      spanContext: () => span.spanContext(),
      parentSpanContext: trace.getSpanContext(parentContext),
      startTime: span.startTime,
      status: span.status,
      attributes: span.attributes,
      links: span.links,
      events: span.events,
      duration: span.duration,
      ended: span.ended,
      resource: span.resource,
      instrumentationScope: span.instrumentationScope,
      droppedAttributesCount: span.droppedAttributesCount,
      droppedEventsCount: span.droppedEventsCount,
      droppedLinksCount: span.droppedLinksCount
    } as ReadableSpan)
  }
}
