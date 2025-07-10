import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { BatchSpanProcessor, ConsoleSpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web'

import { defaultConfig, TraceConfig } from '../trace-core/types/config'
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
    this.processor = spanProcessor || new BatchSpanProcessor(this.getExporter())
    this.provider = new WebTracerProvider({
      spanProcessors: [this.processor]
    })
    this.provider.register({
      propagator: new W3CTraceContextPropagator(),
      contextManager: contextManager
    })
  }

  private static getExporter() {
    if (defaultConfig.endpoint) {
      return new OTLPTraceExporter({
        url: `${defaultConfig.endpoint}/v1/traces`,
        headers: defaultConfig.headers
      })
    }
    return new ConsoleSpanExporter()
  }
}

export const startContext = contextManager.startContextForTopic.bind(contextManager)
export const getContext = contextManager.getContextForTopic.bind(contextManager)
export const endContext = contextManager.endContextForTopic.bind(contextManager)
export const cleanContext = contextManager.cleanContextForTopic.bind(contextManager)
