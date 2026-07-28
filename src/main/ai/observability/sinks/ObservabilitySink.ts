import type { SpanEntity } from '@mcp-trace/trace-core/types/config'
import type { ReadableSpan, TimedEvent } from '@opentelemetry/sdk-trace-base'

export interface ObservabilitySink {
  readonly id: string
  registerTraceMeta?(traceId: string, meta: { topicId: string; modelName?: string }): void | Promise<void>
  writeReadableSpans?(spans: ReadableSpan[]): void | Promise<void>
  writeSpanEntity?(span: SpanEntity): void | Promise<void>
  writeSpanEvent?(traceId: string, spanId: string, event: TimedEvent): void | Promise<void>
  writeRawOtlpPayload?(path: '/v1/traces' | '/v1/logs', payload: unknown): void | Promise<void>
}
