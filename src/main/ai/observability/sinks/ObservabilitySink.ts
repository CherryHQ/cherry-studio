import type { ReadableSpan, TimedEvent } from '@opentelemetry/sdk-trace-base'

import type { SpanEntity } from '@shared/data/types/trace'

export interface ObservabilitySink {
  readonly id: string
  registerTraceMeta?(traceId: string, meta: { topicId: string; modelName?: string }): void | Promise<void>
  writeReadableSpans?(spans: ReadableSpan[]): void | Promise<void>
  writeSpanEntity?(span: SpanEntity): void | Promise<void>
  writeSpanEvent?(traceId: string, spanId: string, event: TimedEvent): void | Promise<void>
  writeRawOtlpPayload?(path: '/v1/traces' | '/v1/logs', payload: unknown): void | Promise<void>
}
