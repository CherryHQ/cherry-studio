import { application } from '@application'
import type { SpanEntity } from '@mcp-trace/trace-core/types/config'
import type { TimedEvent } from '@opentelemetry/sdk-trace-base'

import type { ObservabilitySink } from '../sinks/ObservabilitySink'

class LocalTraceWindowSink implements ObservabilitySink {
  readonly id = 'localTraceWindow'

  registerTraceMeta(traceId: string, meta: { topicId: string; modelName?: string }): void {
    application.get('TraceStorageService').setTopicId(traceId, meta.topicId)
  }

  writeSpanEntity(span: SpanEntity): void {
    application.get('TraceStorageService').saveEntity(span)
  }

  writeSpanEvent(traceId: string, spanId: string, event: TimedEvent): void {
    application.get('TraceStorageService').addSpanEvent(traceId, spanId, event)
  }
}

export const localTraceWindowSink = new LocalTraceWindowSink()
