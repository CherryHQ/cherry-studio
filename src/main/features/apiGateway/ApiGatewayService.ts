import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { createLatestReconciler, type LatestReconciler } from '@main/core/concurrency/latestReconciler'
import { type Activatable, BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { ApiGatewayConfig } from '@shared/types/apiGateway'
import { v4 as uuidv4 } from 'uuid'

import { ApiGateway } from './server'

const logger = loggerService.withContext('ApiGatewayService')

@Injectable('ApiGatewayService')
@ServicePhase(Phase.WhenReady)
export class ApiGatewayService extends BaseService implements Activatable {
  private apiGateway: ApiGateway | null = null
  /** Latest persistent desired state — the `enabled` preference, or the boot auto-start decision. */
  private desiredEnabled = false
  /**
   * Count of active temporary run leases (see {@link acquireLease}). Transient consumers (e.g. PDF
   * translation) hold a lease instead of toggling `desiredEnabled`, so the effective running target
   * is `desiredEnabled || leaseCount > 0`: a lease keeps the gateway up without persisting an
   * "enabled" intent, and it never overrides a user who enables/disables the gateway mid-lease.
   */
  private leaseCount = 0
  /**
   * Converges the gateway's running state to the effective target (`desiredEnabled || leaseCount`).
   * The reconciler is the SOLE caller of activate/deactivate (start/stop/restart and lease
   * acquire/release route through it too), so transitions are never concurrent and the lifecycle's
   * `_activating` short-circuit can't race two owners and leave the running state diverged from the
   * target. It is level-triggered against the ACTUAL `isActivated` state, latest-wins (an opposing
   * toggle landing mid-transition is honoured on the next pass), and a transition that throws for a
   * still-current target is recorded — see {@link LatestReconciler.getLastError} — and not retried,
   * so a persistent failure (e.g. port in use) can't spin the loop.
   */
  private readonly reconciler: LatestReconciler = createLatestReconciler<{ desired: boolean; actual: boolean }>({
    name: 'apiGateway',
    getSnapshot: () => ({ desired: this.desiredEnabled || this.leaseCount > 0, actual: this.isActivated }),
    isSettled: ({ desired, actual }) => desired === actual,
    apply: async ({ desired }) => {
      // Discard activate/deactivate's returned state — the reconciler re-reads `isActivated`.
      if (desired) {
        await this.activate()
      } else {
        await this.deactivate()
      }
    }
  })

  protected async onInit(): Promise<void> {
    // The reconciler holds no OS resources (only closures + flags), so it is not disposed on stop:
    // it is a construct-once field that is NOT recreated on restart (`start()` re-runs `onInit`), and
    // disposing it would permanently no-op `request()` after a stop→restart. After stop, the pref
    // subscription and IPC handlers below are cleaned up, so nothing calls `request()` anyway.
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange('feature.api_gateway.enabled', (enabled) => {
        this.desiredEnabled = enabled
        this.reconciler.request()
        // Reflect the new persistent intent immediately. Matters when a lease already holds the
        // server up: no activate/deactivate transition fires, so `onActivate`/`onDeactivate` won't
        // re-publish, and the running state would otherwise stay stale against the toggle.
        this.publishRunningState(this.isActivated && this.desiredEnabled)
      })
    )
  }

  protected async onReady(): Promise<void> {
    this.desiredEnabled = this.shouldAutoStart()
    this.reconciler.request()
    await this.reconciler.flush()
  }

  async onActivate(): Promise<void> {
    try {
      await this.ensureValidApiKey()
      this.apiGateway = new ApiGateway()
      await this.apiGateway.start()
      // The server just bound, so "running" now tracks the persistent intent: `desiredEnabled` is
      // true for an enabled/auto-started gateway and false when only a transient lease brought it up.
      this.publishRunningState(this.desiredEnabled)
      logger.info('API Gateway activated')
    } catch (error) {
      // Activatable failure contract: clean up partial state before throwing
      if (this.apiGateway) {
        await this.apiGateway.stop().catch(() => {})
        this.apiGateway = null
      }
      this.publishRunningState(false)
      throw error
    }
  }

  async onDeactivate(): Promise<void> {
    if (this.apiGateway) {
      await this.apiGateway.stop()
      this.apiGateway = null
    }
    this.publishRunningState(false)
    logger.info('API Gateway deactivated')
  }

  /**
   * Publish the running state to the shared cache (Main is authoritative). The
   * renderer reads it reactively via `useSharedCache('feature.api_gateway.running')`.
   * This replaces the previous IPC ready-broadcast + EventEmitter listener.
   *
   * "Running" means the gateway is up for a PERSISTENT reason (`desiredEnabled` — enabled or
   * auto-started), NOT merely held open by a transient lease. Callers pass `isActivated &&
   * desiredEnabled` (or `desiredEnabled` from within `onActivate`, where the server has just
   * bound). Keeping a lease-only activation out of this state stops the renderer's
   * running→enabled inference from promoting a temporary lease into a persisted "enabled" pref.
   */
  private publishRunningState(running: boolean): void {
    try {
      application.get('CacheService').setShared('feature.api_gateway.running', running)
    } catch (error) {
      logger.warn('Failed to publish API gateway running state', error as Error)
    }
  }

  async start(): Promise<void> {
    // Set the desired state and converge through the reconciler — never transition directly, so
    // this can't race an opposing toggle; `flush()` waits for the loop to go quiescent.
    this.desiredEnabled = true
    this.reconciler.request()
    await this.reconciler.flush()
    // Re-publish in case a lease already held the gateway up: no activate transition fires, so
    // `onActivate` wouldn't have promoted the (previously lease-only) running state to persistent.
    this.publishRunningState(this.isActivated && this.desiredEnabled)
    if (!this.isActivated) {
      const error = this.failureError('Failed to start API Gateway')
      logger.error('Failed to start API Gateway:', error)
      throw error
    }
    logger.info('API Gateway started successfully')
  }

  async stop(): Promise<void> {
    this.desiredEnabled = false
    this.reconciler.request()
    await this.reconciler.flush()
    // Persistent intent is now off regardless of whether a lease still pins the server up.
    this.publishRunningState(this.isActivated && this.desiredEnabled)
    if (this.isActivated) {
      if (this.leaseCount > 0) {
        // A transient lease still holds the server open; the reconciler will stop it once the last
        // lease releases. Persistent intent is cleared, so this is a success, not a failure.
        logger.info('API Gateway persistent intent cleared; server stays up for active lease(s)')
        return
      }
      const error = this.failureError('Failed to stop API Gateway')
      logger.error('Failed to stop API Gateway:', error)
      throw error
    }
    logger.info('API Gateway stopped successfully')
  }

  async restart(): Promise<void> {
    // Re-create the server (e.g. to apply a new host/port) as a stop→start, so it goes
    // through the same single reconciler — no direct, race-prone transition.
    await this.stop()
    await this.start()
    logger.info('API Gateway restarted successfully')
  }

  /**
   * Acquire a temporary run lease: keep the gateway running for a transient consumer without
   * touching the persistent `enabled` state. Bumps the effective target (`|| leaseCount > 0`) and
   * converges; throws if the gateway could not be brought up (rolling the lease back first). Every
   * successful `acquireLease()` MUST be paired with a `releaseLease()` (in a `finally`).
   *
   * Unlike `start()`/`stop()`, this never rewrites `desiredEnabled`, so it cannot stop a
   * user-enabled gateway on release, and a user disabling the gateway mid-lease cannot cut a
   * running consumer off (the lease still pins the target true until released).
   */
  async acquireLease(): Promise<void> {
    this.leaseCount += 1
    this.reconciler.request()
    await this.reconciler.flush()
    if (!this.isActivated) {
      this.leaseCount = Math.max(0, this.leaseCount - 1)
      this.reconciler.request()
      const error = this.failureError('Failed to start API Gateway for a temporary lease')
      logger.error('Failed to acquire API Gateway lease:', error)
      throw error
    }
  }

  /**
   * Release a lease taken by {@link acquireLease}. Fire-and-forget convergence (matching the
   * preference-subscription path): once the last lease drops and `desiredEnabled` is false, the
   * reconciler stops the gateway on its own.
   */
  releaseLease(): void {
    this.leaseCount = Math.max(0, this.leaseCount - 1)
    this.reconciler.request()
  }

  /** Surface the reconciler's most recent transition error to an IPC caller, or a generic fallback. */
  private failureError(fallback: string): Error {
    const lastError = this.reconciler.getLastError()
    return lastError instanceof Error ? lastError : new Error(fallback)
  }

  isRunning(): boolean {
    return this.apiGateway?.isRunning() ?? false
  }

  getCurrentConfig(): ApiGatewayConfig {
    const config = application.get('PreferenceService').getMultiple({
      enabled: 'feature.api_gateway.enabled',
      host: 'feature.api_gateway.host',
      port: 'feature.api_gateway.port',
      apiKey: 'feature.api_gateway.api_key'
    }) as ApiGatewayConfig

    return config
  }

  async ensureValidApiKey(): Promise<string> {
    const preferenceService = application.get('PreferenceService')
    let apiKey = preferenceService.get('feature.api_gateway.api_key')
    if (typeof apiKey !== 'string' || apiKey.trim() === '') {
      apiKey = `cs-sk-${uuidv4()}`
      await preferenceService.set('feature.api_gateway.api_key', apiKey)
      logger.info('Generated new API key')
    }
    return apiKey
  }

  private shouldAutoStart(): boolean {
    try {
      const config = this.getCurrentConfig()
      // Never log the raw API key — redact before emitting.
      logger.info('API gateway config:', { ...config, apiKey: config.apiKey ? '[redacted]' : null })

      if (config.enabled) {
        return true
      }

      try {
        const { total } = agentService.listAgents({ limit: 1 })
        if (total > 0) {
          logger.info(`Detected ${total} agent(s), auto-starting API gateway`)
          return true
        }
      } catch (error: any) {
        logger.warn('Failed to check agent count:', error)
      }

      return false
    } catch (error: any) {
      logger.error('Failed to check API gateway auto-start condition:', error)
      return false
    }
  }
}
