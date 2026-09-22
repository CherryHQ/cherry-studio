import { application } from '@application'
import { loggerService } from '@logger'
import { type Activatable, BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
// Heavy OTel modules (trace-core processors, trace-node, opentelemetry SDK) are loaded
// via dynamic import() when the lifecycle activates tracing.

const TRACER_NAME = 'CherryStudio'

const logger = loggerService.withContext('NodeTraceService')

@Injectable('NodeTraceService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['TraceStorageService'])
export class NodeTraceService extends BaseService implements Activatable {
  // Stored from dynamic import, needed for shutdown in onDeactivate()
  private nodeTracer: { shutdown(): Promise<void> } | null = null

  /**
   * Basic Agent timing is available regardless of developer mode.
   */
  protected async onReady() {
    await this.activate()
  }

  async onActivate() {
    await this.initTracer()
  }

  /**
   * Only called during app shutdown (auto-deactivation in _doStop).
   *
   * Note: McpNodeTracer.shutdown() only flushes the span processor.
   * Global OTel registrations (TracerProvider, ContextManager, Propagator) persist
   * until process exit. This is acceptable for shutdown-only deactivation.
   */
  async onDeactivate() {
    if (this.nodeTracer) {
      await this.nodeTracer.shutdown()
      this.nodeTracer = null
    }
  }

  /**
   * Initialize the OpenTelemetry tracer with a CacheBatchSpanProcessor
   * that feeds span data into TraceStorageService.
   *
   * Dependencies are loaded via dynamic import() to avoid pulling in heavy OTel SDK
   * modules (NodeTracerProvider, BatchSpanProcessor, OTLPTraceExporter, etc.)
   * at file evaluation time.
   */
  private async initTracer() {
    const [{ FunctionSpanExporter }, { CacheBatchSpanProcessor }, { NodeTracer }] = await Promise.all([
      import('./FunctionSpanExporter'),
      import('./CacheBatchSpanProcessor'),
      import('./NodeTracer')
    ])

    this.nodeTracer = NodeTracer
    const traceStorageService = application.get('TraceStorageService')
    const exporter = new FunctionSpanExporter(async (spans) => {
      logger.info(`Spans length: ${spans.length}`)
    })

    NodeTracer.init(
      {
        defaultTracerName: TRACER_NAME,
        serviceName: TRACER_NAME
      },
      new CacheBatchSpanProcessor(exporter, traceStorageService)
    )
  }
}
