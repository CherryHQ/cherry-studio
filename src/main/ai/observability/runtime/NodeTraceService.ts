import { application } from '@application'
import { loggerService } from '@logger'
import { createLatestReconciler, type LatestReconciler } from '@main/core/concurrency/latestReconciler'
import { type Activatable, BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
// Heavy OTel modules (trace-core processors, trace-node, opentelemetry SDK) are loaded
// via dynamic import() in initTracer() to avoid startup overhead when developer_mode is off.

const TRACER_NAME = 'CherryStudio'

const logger = loggerService.withContext('NodeTraceService')

@Injectable('NodeTraceService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['TraceStorageService', 'ClaudeCodeTraceBridgeService'])
export class NodeTraceService extends BaseService implements Activatable {
  // Stored from dynamic import, needed for shutdown in onDeactivate()
  private nodeTracer: { shutdown(): Promise<void> } | null = null
  /** Invalidates a deferred dynamic import when this service starts shutting down. */
  private activationGeneration = 0
  /** Latest desired state from app.developer_mode.enabled. */
  private desiredEnabled = false

  /**
   * Coordinates tracing and its storage as one latest-wins runtime feature. Each pass performs only
   * one transition, then re-reads the latest preference before continuing. This preserves the
   * required order (storage -> tracer on enable, tracer -> storage on disable) without completing a
   * stale multi-step transition when the user toggles developer mode rapidly.
   */
  private readonly reconciler: LatestReconciler = createLatestReconciler<{
    desired: boolean
    traceActive: boolean
    storageActive: boolean
    claudeCodeBridgeActive: boolean
  }>({
    name: 'developerTracing',
    getSnapshot: () => ({
      desired: this.desiredEnabled,
      traceActive: this.isActivated,
      storageActive: application.get('TraceStorageService').isActivated,
      claudeCodeBridgeActive: application.get('ClaudeCodeTraceBridgeService').isActivated
    }),
    isSettled: ({ desired, traceActive, storageActive, claudeCodeBridgeActive }) =>
      desired
        ? traceActive && storageActive && claudeCodeBridgeActive
        : !traceActive && !storageActive && !claudeCodeBridgeActive,
    apply: async ({ desired, traceActive, storageActive, claudeCodeBridgeActive }) => {
      if (desired) {
        if (!storageActive) {
          await application.activate('TraceStorageService')
          if (!application.get('TraceStorageService').isActivated) {
            throw new Error('Failed to activate TraceStorageService')
          }
          return
        }
        if (!traceActive) {
          await application.activate('NodeTraceService')
          if (!this.isActivated) {
            throw new Error('Failed to activate NodeTraceService')
          }
          return
        }
        if (!claudeCodeBridgeActive) {
          await application.activate('ClaudeCodeTraceBridgeService')
          if (!application.get('ClaudeCodeTraceBridgeService').isActivated) {
            throw new Error('Failed to activate ClaudeCodeTraceBridgeService')
          }
        }
        return
      }

      // The bridge must stop accepting telemetry before either downstream tracing component is
      // torn down. Its HTTP server and trace-context registry are both lifecycle-owned.
      if (claudeCodeBridgeActive) {
        await application.deactivate('ClaudeCodeTraceBridgeService')
        if (application.get('ClaudeCodeTraceBridgeService').isActivated) {
          throw new Error('Failed to deactivate ClaudeCodeTraceBridgeService')
        }
        return
      }
      if (traceActive) {
        await application.deactivate('NodeTraceService')
        if (this.isActivated) {
          throw new Error('Failed to deactivate NodeTraceService')
        }
        return
      }
      if (storageActive) {
        await application.deactivate('TraceStorageService')
        if (application.get('TraceStorageService').isActivated) {
          throw new Error('Failed to deactivate TraceStorageService')
        }
      }
    }
  })

  protected async onInit() {
    // The reconciler is construct-once and must survive a service stop -> start. Only the preference
    // subscription is lifecycle-scoped and is re-created when onInit runs again.
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange('app.developer_mode.enabled', (enabled) => {
        this.desiredEnabled = enabled
        this.reconciler.request()
      })
    )
  }

  /**
   * Converge startup state before dependants can emit spans. TraceStorageService initializes first
   * through @DependsOn; subsequent preference changes use the same reconciler at runtime.
   */
  protected async onReady() {
    this.desiredEnabled = application.get('PreferenceService').get('app.developer_mode.enabled')
    this.reconciler.request()
    await this.reconciler.flush()
    logger.info(
      `Developer mode is ${this.desiredEnabled ? 'enabled' : 'disabled'}, tracing ${this.isActivated ? 'active' : 'inactive'}`
    )
  }

  async onActivate() {
    const generation = ++this.activationGeneration
    await this.initTracer(generation)
  }

  /** Flush spans and unregister the active OpenTelemetry runtime. */
  async onDeactivate() {
    this.activationGeneration++
    if (this.nodeTracer) {
      const nodeTracer = this.nodeTracer
      this.nodeTracer = null
      try {
        await nodeTracer.shutdown()
      } catch (error) {
        // NodeTracer unregisters all OTel globals in a finally block, so the runtime is off even if
        // a processor/exporter failed to flush. Keep lifecycle state aligned with that reality.
        logger.error('Failed to flush tracing during deactivation:', error as Error)
      }
    }
  }

  protected onStop(): void {
    // `_doStop` cannot call onDeactivate while activation is still pending,
    // because BaseService has not marked the service active yet. Invalidate the
    // pending load here so it cannot publish an OTel provider after shutdown.
    this.activationGeneration++
  }

  /**
   * Initialize the OpenTelemetry tracer with a CacheBatchSpanProcessor
   * that feeds span data into TraceStorageService.
   *
   * Dependencies are loaded via dynamic import() to avoid pulling in heavy OTel SDK
   * modules (NodeTracerProvider, BatchSpanProcessor, OTLPTraceExporter, etc.)
   * at file evaluation time — keeping startup fast when developer_mode is off.
   */
  private loadTracerDependencies() {
    return Promise.all([import('./FunctionSpanExporter'), import('./CacheBatchSpanProcessor'), import('./NodeTracer')])
  }

  private async initTracer(generation: number) {
    const [{ FunctionSpanExporter }, { CacheBatchSpanProcessor }, { NodeTracer }] = await this.loadTracerDependencies()
    if (generation !== this.activationGeneration) {
      throw new Error('Node tracing activation was cancelled during shutdown')
    }

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
    this.nodeTracer = NodeTracer
  }
}
