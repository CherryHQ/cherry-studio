/**
 * AdapterTracer — wraps an OTel tracer so every AI SDK span reaches observability sinks.
 *
 * Patches each span's `end()` to also convert the span via `AiSdkSpanAdapter`
 * and hand it to the sink registry. This is for AI SDK telemetry only;
 * Cherry-owned root spans use `startAiTurnTrace`.
 */

import { context as otelContext, trace, type Context, type Span, type Tracer } from '@opentelemetry/api'

import { loggerService } from '@logger'

import { observabilitySinks } from '../../sinks/ObservabilitySinkRegistry'
import { AiSdkSpanAdapter } from './aiSdkSpanAdapter'

const logger = loggerService.withContext('AdapterTracer')

export class AdapterTracer {
  constructor(
    private readonly inner: Tracer,
    private readonly topicId: string,
    private readonly modelName?: string,
    private readonly parentContext?: Context
  ) {}

  private instrumentSpan(span: Span, name: string): Span {
    const originalEnd = span.end.bind(span)

    span.end = (endTime?: any) => {
      originalEnd(endTime)
      try {
        const spanEntity = AiSdkSpanAdapter.convertToSpanEntity({
          span,
          topicId: this.topicId,
          modelName: this.modelName
        })
        observabilitySinks.writeSpanEntity(spanEntity)
      } catch (error) {
        logger.warn(`Failed to persist span ${name}`, error as Error)
      }
    }
    if (this.topicId) span.setAttribute('trace.topicId', this.topicId)
    if (this.modelName) span.setAttribute('trace.modelName', this.modelName)
    return span
  }

  startSpan: Tracer['startSpan'] = (name, options, context) => {
    const activeContext = context ?? otelContext.active()
    const parent = trace.getSpanContext(activeContext) ? activeContext : (this.parentContext ?? activeContext)
    const span = this.inner.startSpan(name, options, parent)
    return this.instrumentSpan(span, name)
  }

  // AI SDK only calls the (name, fn) / (name, options, fn) overloads; we
  // mirror all four for completeness.
  startActiveSpan: Tracer['startActiveSpan'] = ((name: string, ...args: any[]): any => {
    const fnIndex = args.findIndex((a) => typeof a === 'function')
    if (fnIndex < 0) throw new Error('AdapterTracer.startActiveSpan: no callback provided')

    const fn = args[fnIndex] as (span: Span) => any
    const options = fnIndex === 0 ? {} : args[0]
    const activeContext = fnIndex === 2 ? (args[1] as Context) : otelContext.active()
    const parent = trace.getSpanContext(activeContext) ? activeContext : (this.parentContext ?? activeContext)
    return this.inner.startActiveSpan(name, options, parent, (span) => fn(this.instrumentSpan(span, name)))
  }) as Tracer['startActiveSpan']
}
