/**
 * AI SDK → Cherry trace bridge (Main).
 *
 * Injects `experimental_telemetry` into streamText / generateText params so AI
 * SDK produces OTel spans, then wraps those spans with `AiSdkSpanAdapter` to
 * convert each one into a `SpanEntity` and stash it in `SpanCacheService` for
 * the trace viewer window.
 *
 * Scaled-down vs. the deleted renderer plugin:
 *  - No per-topic parent-span lookup. The renderer's `SpanManagerService`
 *    (topicId → active root span) has no Main equivalent yet, so AI SDK
 *    spans surface as trace roots. Nesting them under a topic-level span
 *    is a follow-up once a Main span manager lands.
 *  - `SpanCacheService.saveEntity` is called directly (no IPC round-trip).
 */

import type { AiPlugin, StreamTextParams, StreamTextResult } from '@cherrystudio/ai-core'
import { definePlugin } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import type { Span, Tracer } from '@opentelemetry/api'
import { trace } from '@opentelemetry/api'
import type { TelemetrySettings } from 'ai'

import { AiSdkSpanAdapter } from '../trace/AiSdkSpanAdapter'

const logger = loggerService.withContext('telemetryPlugin')
const TRACER_NAME = 'CherryStudio'

export interface TelemetryPluginConfig {
  topicId: string
  modelName?: string
  recordInputs?: boolean
  recordOutputs?: boolean
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

export const createTelemetryPlugin = (config: TelemetryPluginConfig): AiPlugin<StreamTextParams, StreamTextResult> =>
  definePlugin<StreamTextParams, StreamTextResult>({
    name: 'telemetry',
    enforce: 'pre',
    transformParams: (params, context) => {
      const inner = trace.getTracer(TRACER_NAME)
      const topicId = (context.topicId as string | undefined) ?? config.topicId
      const modelName = config.modelName ?? (context.modelId as string | undefined)
      const adapterTracer = new AdapterTracer(inner, topicId, modelName)

      const telemetry: TelemetrySettings = {
        isEnabled: true,
        recordInputs: config.recordInputs ?? true,
        recordOutputs: config.recordOutputs ?? true,
        tracer: adapterTracer,
        functionId: `ai-request-${context.requestId ?? 'unknown'}`,
        metadata: {
          providerId: String(context.providerId ?? ''),
          modelId: String(context.modelId ?? ''),
          topicId,
          modelName: modelName ?? '',
          'trace.topicId': topicId,
          'trace.modelName': modelName ?? ''
        }
      }

      return { ...params, experimental_telemetry: telemetry }
    }
  })
