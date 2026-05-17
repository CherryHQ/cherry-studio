import { W3CTraceContextPropagator } from '@opentelemetry/core'
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'

import type { TraceConfig } from '../trace-core/types/config'
import { defaultConfig } from '../trace-core/types/config'
import { TopicContextManager } from './TopicContextManager'

export const contextManager = new TopicContextManager()

export class WebTracer {
  private static provider: WebTracerProvider
  private static processor: SpanProcessor

  static init(config?: TraceConfig, spanProcessor?: SpanProcessor) {
    if (config) {
      defaultConfig.serviceName = config.serviceName || defaultConfig.serviceName
      defaultConfig.endpoint = config.endpoint || defaultConfig.endpoint
      defaultConfig.headers = config.headers || defaultConfig.headers
      defaultConfig.defaultTracerName = config.defaultTracerName || defaultConfig.defaultTracerName
    }
    // Callers are expected to pass a processor. The dev-only fallback logs
    // spans to the console so that a misconfigured caller doesn't silently
    // lose data — renderer → main IPC persistence flows through the injected
    // processor (see WebTraceService.init).
    this.processor = spanProcessor || new SimpleSpanProcessor(new ConsoleSpanExporter())
    this.provider = new WebTracerProvider({
      spanProcessors: [this.processor]
    })
    this.provider.register({
      propagator: new W3CTraceContextPropagator(),
      contextManager: contextManager
    })
  }
}

export const startContext = contextManager.startContextForTopic.bind(contextManager)
export const getContext = contextManager.getContextForTopic.bind(contextManager)
export const endContext = contextManager.endContextForTopic.bind(contextManager)
export const cleanContext = contextManager.cleanContextForTopic.bind(contextManager)
