import { trace, Tracer } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { BatchSpanProcessor, ConsoleSpanExporter, SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

import { defaultConfig, TraceConfig } from '../trace-core/types/config'

export class NodeTracer {
  private static provider: NodeTracerProvider
  private static defaultTracer: Tracer
  private static spanProcessor: SpanProcessor

  static init(config?: TraceConfig, spanProcessor?: SpanProcessor) {
    if (config) {
      defaultConfig.serviceName = config.serviceName || defaultConfig.serviceName
      defaultConfig.endpoint = config.endpoint || defaultConfig.endpoint
      defaultConfig.headers = config.headers || defaultConfig.headers
      defaultConfig.defaultTracerName = config.defaultTracerName || defaultConfig.defaultTracerName
    }
    this.spanProcessor = spanProcessor || new BatchSpanProcessor(this.getExporter())
    this.provider = new NodeTracerProvider({
      spanProcessors: [this.spanProcessor]
    })
    this.provider.register({
      propagator: new W3CTraceContextPropagator(),
      contextManager: new AsyncLocalStorageContextManager()
    })
    this.defaultTracer = trace.getTracer(config?.defaultTracerName || 'default')
  }

  private static getExporter(config?: TraceConfig) {
    if (config && config.endpoint) {
      return new OTLPTraceExporter({
        url: `${config.endpoint}/v1/traces`,
        headers: config.headers || undefined
      })
    }
    return new ConsoleSpanExporter()
  }

  public static getTracer() {
    return this.defaultTracer
  }
}
