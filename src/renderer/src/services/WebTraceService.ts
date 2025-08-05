import { loggerService } from '@logger'
import { convertSpanToSpanEntity, FunctionSpanExporter, FunctionSpanProcessor } from '@mcp-trace/trace-core'
import { WebTracer } from '@mcp-trace/trace-web'
import { ReadableSpan } from '@opentelemetry/sdk-trace-base'

const logger = loggerService.withContext('WebTraceService')

const TRACER_NAME = 'CherryStudio'

class WebTraceService {
  init() {
    const exporter = new FunctionSpanExporter((spans: ReadableSpan[]): Promise<void> => {
      // Implement your save logic here if needed
      // For now, just resolve immediately
      logger.info(`Saving spans: ${spans.length}`)
      return Promise.resolve()
    })

    const processor = new FunctionSpanProcessor(
      exporter,
      (span: ReadableSpan) => {
        window.api.trace.saveEntity(convertSpanToSpanEntity(span))
      },
      (span: ReadableSpan) => {
        window.api.trace.saveEntity(convertSpanToSpanEntity(span))
      }
    )
    WebTracer.init(
      {
        defaultTracerName: TRACER_NAME,
        serviceName: TRACER_NAME
      },
      processor
    )
  }
}

export const webTraceService = new WebTraceService()
