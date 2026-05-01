import { loggerService } from '@logger'
import { application } from '@main/core/application'
import type { Span, Tracer } from '@opentelemetry/api'
import { trace } from '@opentelemetry/api'
import type { TelemetrySettings } from 'ai'

import { AiSdkSpanAdapter } from './aiSdkSpanAdapter'
import type { RequestScope } from './scope'

const logger = loggerService.withContext('buildTelemetry')
const TRACER_NAME = 'CherryStudio'

/**
 * Build telemetry settings for the request, or `undefined` to disable
 * tracing. Active iff developer mode is on AND we have a topicId to
 * attribute spans to.
 */
export function buildTelemetry(scope: RequestScope): TelemetrySettings | undefined {
  const topicId = scope.requestContext.topicId
  if (!topicId) return undefined
  const developerModeEnabled = application.get('PreferenceService').get('app.developer_mode.enabled')
  if (!developerModeEnabled) return undefined

  const modelName = scope.model.name ?? scope.model.id
  return {
    isEnabled: true,
    recordInputs: true,
    recordOutputs: true,
    tracer: new AdapterTracer(trace.getTracer(TRACER_NAME), topicId, modelName),
    functionId: `ai-request-${scope.requestContext.requestId}`,
    metadata: {
      providerId: String(scope.sdkConfig.providerId),
      modelId: scope.sdkConfig.modelId,
      topicId,
      modelName,
      'trace.topicId': topicId,
      'trace.modelName': modelName
    }
  }
}

/** Wraps an OTel tracer so every span's `end()` persists a converted SpanEntity. */
class AdapterTracer {
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
        application.get('SpanCacheService').saveEntity(spanEntity)
      } catch (error) {
        logger.warn(`Failed to persist AI SDK span ${name}`, error as Error)
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
