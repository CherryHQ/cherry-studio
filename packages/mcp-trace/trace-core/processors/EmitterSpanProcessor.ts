import { Context } from '@opentelemetry/api'
import { BatchSpanProcessor, BufferConfig, ReadableSpan, Span, SpanExporter } from '@opentelemetry/sdk-trace-base'
import { EventEmitter } from 'stream'

import { convertSpanToSpanEntity } from '../core/spanConvert'

export const TRACE_DATA_EVENT = 'trace_data_event'
export const ON_START = 'start'
export const ON_END = 'end'

export class EmitterSpanProcessor extends BatchSpanProcessor {
  private emitter: EventEmitter

  constructor(_exporter: SpanExporter, emitter: NodeJS.EventEmitter, config?: BufferConfig) {
    super(_exporter, config)
    this.emitter = emitter
  }

  override onEnd(span: ReadableSpan): void {
    super.onEnd(span)
    this.emitter.emit(TRACE_DATA_EVENT, ON_END, convertSpanToSpanEntity(span))
  }

  override onStart(span: Span, parentContext: Context): void {
    super.onStart(span, parentContext)
    this.emitter.emit(TRACE_DATA_EVENT, ON_START, convertSpanToSpanEntity(span))
  }
}
