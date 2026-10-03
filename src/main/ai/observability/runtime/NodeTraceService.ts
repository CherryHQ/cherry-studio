import { application } from '@application'
import { loggerService } from '@logger'
import { type Activatable, BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
// Heavy OTel modules (trace-core processors, trace-node, opentelemetry SDK) are loaded
// via dynamic import() in initTracer() to avoid startup overhead when developer_mode is off.

const TRACER_NAME = 'CherryStudio'

const logger = loggerService.withContext('NodeTraceService')

@Injectable('NodeTraceService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['TraceStorageService'])
export class NodeTraceService extends BaseService implements Activatable {
  // Stored from dynamic import, needed for shutdown in onDeactivate()
  private nodeTracer: { shutdown(): Promise<void> } | null = null

  /**
   * Activate only when developer_mode is enabled at startup.
   * Runtime preference changes take effect after restart — no runtime activate/deactivate.
   */
  protected async onReady() {
    const enabled = application.get('PreferenceService').get('app.developer_mode.enabled')
    logger.info(`Developer mode is ${enabled ? 'enabled' : 'disabled'}, tracing ${enabled ? 'activated' : 'skipped'}`)
    if (enabled) {
      await this.activate()
    }
  }

  async onActivate() {
    await this.initTracer()
  }

  /**
   * Only called during app shutdown (auto-deactivation in _doStop).
   * Runtime deactivation is not supported — developer_mode changes require restart.
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
   * at file evaluation time — keeping startup fast when developer_mode is off.
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
