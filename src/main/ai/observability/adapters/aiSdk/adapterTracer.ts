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
        logger.warn(`Failed to persist span ${name}`, error)
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

  // Mirror all three OTel overloads; AI SDK uses the callback forms without explicit Context.
  // SAFETY: Tracer callers select a declared overload; forwarding preserves the callback's return value and generic result.
  startActiveSpan: Tracer['startActiveSpan'] = ((name: string, ...args: any[]): any => {
    const fnIndex = args.findIndex((a) => typeof a === 'function')

    if (fnIndex < 0) throw new Error('AdapterTracer.startActiveSpan: no callback provided')

    // SAFETY: findIndex selected the callback supplied by the Tracer overload; it receives the instrumented Span below.
    const fn = args[fnIndex] as (span: Span) => any
    const options = fnIndex === 0 ? {} : args[0]
    // SAFETY: The three-argument overload tail is [options, Context, callback], so index 2 identifies the Context slot.
    const activeContext = fnIndex === 2 ? (args[1] as Context) : otelContext.active()
    const parent = trace.getSpanContext(activeContext) ? activeContext : (this.parentContext ?? activeContext)

    return this.inner.startActiveSpan(name, options, parent, (span) => fn(this.instrumentSpan(span, name)))
  }) as Tracer['startActiveSpan']
}
