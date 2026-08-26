import { loggerService } from '@logger'
import { context, diag, type DiagLogger, DiagLogLevel, propagation, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { BatchSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

import type { TraceConfig } from '../traceConfig'
import { defaultConfig } from '../traceConfig'

const logger = loggerService.withContext('OpenTelemetry')

const diagnosticLogger: DiagLogger = {
  error: (message, ...args) => logger.error(message, { arguments: args }),
  warn: (message, ...args) => logger.warn(message, { arguments: args }),
  info: (message, ...args) => logger.info(message, { arguments: args }),
  debug: (message, ...args) => logger.debug(message, { arguments: args }),
  verbose: (message, ...args) => logger.verbose(message, { arguments: args })
}

export class NodeTracer {
  private static provider: NodeTracerProvider | null = null

  static init(config?: TraceConfig, spanProcessor?: SpanProcessor) {
    if (config) {
      defaultConfig.serviceName = config.serviceName || defaultConfig.serviceName
      defaultConfig.endpoint = config.endpoint || defaultConfig.endpoint
      defaultConfig.headers = config.headers || defaultConfig.headers
      defaultConfig.defaultTracerName = config.defaultTracerName || defaultConfig.defaultTracerName
    }
    // Keep OTel's normally silent global-registration failures in Cherry's logs. The diagnostic
    // logger is process-wide and intentionally remains installed across tracing sessions.
    diag.setLogger(diagnosticLogger, { logLevel: DiagLogLevel.WARN, suppressOverrideMessage: true })

    const processor = spanProcessor || new BatchSpanProcessor(this.getExporter())
    const provider = new NodeTracerProvider({
      spanProcessors: [processor]
    })
    this.provider = provider
    provider.register({
      propagator: new W3CTraceContextPropagator(),
      contextManager: new AsyncLocalStorageContextManager()
    })
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
    return trace.getTracer(defaultConfig.defaultTracerName || 'default')
  }

  /**
   * Gracefully shut down the OpenTelemetry provider.
   * Flushes pending spans and releases exporter resources.
   */
  static async shutdown() {
    const provider = this.provider
    if (!provider) return

    this.provider = null
    try {
      await provider.shutdown()
    } finally {
      // provider.shutdown() flushes processors but does not unregister API globals. All three must
      // be removed before a later provider/context/propagator can be registered successfully.
      propagation.disable()
      context.disable()
      trace.disable()
    }
  }
}
