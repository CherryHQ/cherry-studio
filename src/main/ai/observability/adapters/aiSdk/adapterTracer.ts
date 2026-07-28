/**
 * AdapterTracer — wraps an OTel tracer so every AI SDK span reaches observability sinks.
 *
 * Patches each span's `end()` to also convert the span via `AiSdkSpanAdapter`
 * and hand it to the sink registry. This is for AI SDK telemetry only;
 * Cherry-owned root spans use `startAiTurnTrace`.
 */

import { loggerService } from '@logger'
import type { Span, Tracer } from '@opentelemetry/api'

import { observabilitySinks } from '../../sinks/ObservabilitySinkRegistry'
import { AiSdkSpanAdapter } from './aiSdkSpanAdapter'

const logger = loggerService.withContext('AdapterTracer')

export class AdapterTracer {
  constructor(
    private readonly inner: Tracer,
    private readonly topicId: string,
    private readonly modelName?: string
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
    const span = this.inner.startSpan(name, options, context)
    return this.instrumentSpan(span, name)
  }

  // AI SDK only calls the (name, fn) / (name, options, fn) overloads; we
  // mirror all four for completeness.
  startActiveSpan: Tracer['startActiveSpan'] = ((name: string, ...args: any[]): any => {
    const fnIndex = args.findIndex((a) => typeof a === 'function')
    if (fnIndex < 0) throw new Error('AdapterTracer.startActiveSpan: no callback provided')

    const fn = args[fnIndex] as (span: Span) => any
    const forwarded = [...args]
    forwarded[fnIndex] = (span: Span) => fn(this.instrumentSpan(span, name))

    return (this.inner.startActiveSpan as any)(name, ...forwarded)
  }) as Tracer['startActiveSpan']
}
