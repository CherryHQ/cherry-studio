import { loggerService } from '@logger'

import { localTraceWindowSink } from '../storage/LocalTraceWindowSink'
import type { ObservabilitySink } from './ObservabilitySink'

const logger = loggerService.withContext('ObservabilitySinkRegistry')

class ObservabilitySinkRegistry {
  private readonly sinks = new Map<string, ObservabilitySink>()

  constructor() {
    this.register(localTraceWindowSink)
  }

  register(sink: ObservabilitySink): void {
    this.sinks.set(sink.id, sink)
  }

  getAll(): ObservabilitySink[] {
    return [...this.sinks.values()]
  }

  registerTraceMeta(traceId: string, meta: { topicId: string; modelName?: string }): void {
    for (const sink of this.sinks.values()) {
      this.callSink(sink, 'registerTraceMeta', () => sink.registerTraceMeta?.(traceId, meta))
    }
  }

  writeReadableSpans(spans: Parameters<NonNullable<ObservabilitySink['writeReadableSpans']>>[0]): void {
    for (const sink of this.sinks.values()) {
      this.callSink(sink, 'writeReadableSpans', () => sink.writeReadableSpans?.(spans))
    }
  }

  writeSpanEntity(span: Parameters<NonNullable<ObservabilitySink['writeSpanEntity']>>[0]): void {
    for (const sink of this.sinks.values()) {
      this.callSink(sink, 'writeSpanEntity', () => sink.writeSpanEntity?.(span))
    }
  }

  writeSpanEvent(
    traceId: string,
    spanId: string,
    event: Parameters<NonNullable<ObservabilitySink['writeSpanEvent']>>[2]
  ): void {
    for (const sink of this.sinks.values()) {
      this.callSink(sink, 'writeSpanEvent', () => sink.writeSpanEvent?.(traceId, spanId, event))
    }
  }

  writeRawOtlpPayload(
    otlpPath: Parameters<NonNullable<ObservabilitySink['writeRawOtlpPayload']>>[0],
    payload: unknown
  ): void {
    for (const sink of this.sinks.values()) {
      this.callSink(sink, 'writeRawOtlpPayload', () => sink.writeRawOtlpPayload?.(otlpPath, payload))
    }
  }

  private callSink(sink: ObservabilitySink, operation: string, fn: () => void | Promise<void> | undefined): void {
    try {
      const result = fn()
      if (result && typeof result.catch === 'function') {
        void result.catch((error) => {
          logger.warn(`Observability sink ${sink.id} failed ${operation}`, error as Error)
        })
      }
    } catch (error) {
      logger.warn(`Observability sink ${sink.id} failed ${operation}`, error as Error)
    }
  }
}

export const observabilitySinks = new ObservabilitySinkRegistry()
