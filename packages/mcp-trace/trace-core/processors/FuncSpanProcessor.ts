import { Context, trace } from '@opentelemetry/api'
import { BatchSpanProcessor, BufferConfig, ReadableSpan, Span, SpanExporter } from '@opentelemetry/sdk-trace-base'

export type SpanFunction = (span: ReadableSpan) => void

export class FunctionSpanProcessor extends BatchSpanProcessor {
  private start: SpanFunction
  private end: SpanFunction

  constructor(_exporter: SpanExporter, start: SpanFunction, end: SpanFunction, config?: BufferConfig) {
    super(_exporter, config)
    this.start = start
    this.end = end
  }

  override onEnd(span: ReadableSpan): void {
    super.onEnd(span)
    this.end(span)
  }

  override onStart(span: Span, parentContext: Context): void {
    super.onStart(span, parentContext)
    this.start({
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
