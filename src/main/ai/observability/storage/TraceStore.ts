import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'

export interface TraceStore {
  createSpan: (span: ReadableSpan) => void
  endSpan: (span: ReadableSpan) => void
  clear: () => void
}
