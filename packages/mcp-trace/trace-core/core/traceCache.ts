import { ReadableSpan } from '@opentelemetry/sdk-trace-base'

export interface TraceCache {
  createSpan: (span: ReadableSpan) => void
  endSpan: (span: ReadableSpan) => void
  clear: () => void
}
