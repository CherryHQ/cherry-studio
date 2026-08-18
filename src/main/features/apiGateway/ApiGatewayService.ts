import { timingSafeEqual } from 'node:crypto'

import { application } from '@application'
import { loggerService } from '@logger'
import type { InProcessUsageContext } from '@main/ai/types'
import { createLatestReconciler, type LatestReconciler } from '@main/core/concurrency/latestReconciler'
import { type Activatable, BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { ApiGatewayConfig } from '@shared/types/apiGateway'
import { REDACTED } from '@shared/utils/redaction'
import { v4 as uuidv4 } from 'uuid'

import type { ApiGateway } from './server'

const logger = loggerService.withContext('ApiGatewayService')
const AGENT_SESSION_ID_HEADER = 'x-cherry-agent-session-id'
const INTERNAL_USAGE_TOKEN_HEADER = 'x-cherry-internal-usage-token'

@Injectable('ApiGatewayService')
@ServicePhase(Phase.WhenReady)
export class ApiGatewayService extends BaseService implements Activatable {
  private apiGateway: ApiGateway | null = null
  /** Process-local proof that a gateway request originated from Cherry's agent runtime. */
  private readonly internalUsageToken = uuidv4()
  /** Never persisted or exposed through the public API; authenticates Cherry-internal gateway metadata. */
  private readonly internalRequestToken = uuidv4()
  /** Latest desired running state. The `enabled` preference is its ONLY source: nothing auto-starts
   *  the gateway, so a user who turns it off keeps it off across restarts (issue #18521). */
  private desiredEnabled = false
  /**
   * Converges the gateway's running state to `desiredEnabled`. The reconciler is the SOLE caller
   * of activate/deactivate (start/stop/restart route through it too), so transitions are never
   * concurrent and the lifecycle's `_activating` short-circuit can't race two owners and leave the
   * running state diverged from `desiredEnabled`. It is level-triggered against the ACTUAL
   * `isActivated` state, latest-wins (an opposing toggle landing mid-transition is honoured on the
   * next pass), and a transition that throws for a still-current target is recorded — see
   * {@link LatestReconciler.getLastError} — and not retried, so a persistent failure (e.g. port in
   * use) can't spin the loop.
   */
  private readonly reconciler: LatestReconciler = createLatestReconciler<{ desired: boolean; actual: boolean }>({
    name: 'apiGateway',
    getSnapshot: () => ({ desired: this.desiredEnabled, actual: this.isActivated }),
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
      })
    )
  }

  protected async onReady(): Promise<void> {
    const config = this.getCurrentConfig()
    // Never log the raw API key — redact before emitting.
    logger.info('API gateway config:', { ...config, apiKey: config.apiKey ? REDACTED : null })
    this.desiredEnabled = config.enabled
    this.reconciler.request()
    await this.reconciler.flush()
  }

  async onActivate(): Promise<void> {
    try {
      await this.ensureValidApiKey()
      const { ApiGateway } = await import('./server')
      this.apiGateway = new ApiGateway()
      await this.apiGateway.start()
      this.publishRunningState(true)
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
   */
  private publishRunningState(running: boolean): void {
    try {
      application.get('CacheService').setShared('feature.api_gateway.running', running)
    } catch (error) {
      logger.warn('Failed to publish API gateway running state', error as Error)
    }
  }

  /**
   * Converge the runtime on `enabled` through the reconciler — never transition directly, so this
   * can't race an opposing toggle; `flush()` waits for the loop to go quiescent.
   */
  private async converge(enabled: boolean): Promise<void> {
    this.desiredEnabled = enabled
    this.reconciler.request()
    await this.reconciler.flush()
  }

  /**
   * Persist the intent BEFORE converging, in the same authoritative call. A runtime transition
   * whose persisted intent never landed is exactly the divergence #18521 was about — a stop that
   * left `enabled: true` behind reopens the port on the next launch. The preference write throws
   * on failure, so the caller learns the intent did not stick.
   */
  private async applyIntent(enabled: boolean): Promise<void> {
    await application.get('PreferenceService').set('feature.api_gateway.enabled', enabled)
    // `subscribeChange` fires only on an actual change, so drive the reconciler here as well.
    await this.converge(enabled)
  }

  async start(): Promise<void> {
    await this.applyIntent(true)
    if (!this.isActivated) {
      const error = this.failureError('Failed to start API Gateway')
      logger.error('Failed to start API Gateway:', error)
      throw error
    }
    logger.info('API Gateway started successfully')
  }

  async stop(): Promise<void> {
    await this.applyIntent(false)
    if (this.isActivated) {
      const error = this.failureError('Failed to stop API Gateway')
      logger.error('Failed to stop API Gateway:', error)
      throw error
    }
    logger.info('API Gateway stopped successfully')
  }

  async restart(): Promise<void> {
    // Re-create the server (e.g. to apply a new host/port) as a stop→start through the same single
    // reconciler. A re-bind is not an intent change, so the persisted preference is left alone.
    await this.converge(false)
    // Re-read the intent before re-activating: another window may have persisted a stop while this
    // restart was queued behind it, and a re-bind must never resurrect a gateway the user disabled.
    if (!this.getCurrentConfig().enabled) {
      const error = new Error('API Gateway was disabled while restarting')
      logger.warn('Aborting API Gateway restart: the gateway was disabled meanwhile')
      throw error
    }
    await this.converge(true)
    if (!this.isActivated) {
      const error = this.failureError('Failed to restart API Gateway')
      logger.error('Failed to restart API Gateway:', error)
      throw error
    }
    logger.info('API Gateway restarted successfully')
  }

  /**
   * Converge an already-enabled gateway toward running. Unlike {@link start} this never touches the
   * persisted intent, so a caller that merely needs the gateway up (an agent route whose model must
   * be bridged) can wait for readiness without being able to re-enable what a user disabled.
   */
  async ensureRunning(): Promise<void> {
    if (!this.getCurrentConfig().enabled) {
      throw new Error('API Gateway is disabled')
    }
    await this.converge(true)
    if (!this.isActivated) {
      const error = this.failureError('Failed to start API Gateway')
      logger.error('Failed to start API Gateway:', error)
      throw error
    }
  }

  /** Surface the reconciler's most recent transition error to an IPC caller, or a generic fallback. */
  private failureError(fallback: string): Error {
    const lastError = this.reconciler.getLastError()
    return lastError instanceof Error ? lastError : new Error(fallback)
  }

  isRunning(): boolean {
    return this.apiGateway?.isRunning() ?? false
  }

  getInternalRequestToken(): string {
    return this.internalRequestToken
  }

  isInternalRequestToken(candidate: string | undefined): boolean {
    if (!candidate) return false
    const expected = Buffer.from(this.internalRequestToken)
    const received = Buffer.from(candidate)
    return expected.length === received.length && timingSafeEqual(expected, received)
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

  /**
   * Headers injected only into the Claude Agent SDK subprocess that Cherry
   * launches for this session. They let the HTTP gateway retain per-provider
   * request records while attaching them to the owning agent.
   */
  getAgentSessionUsageHeaders(sessionId: string): Record<string, string> {
    return {
      [AGENT_SESSION_ID_HEADER]: sessionId,
      [INTERNAL_USAGE_TOKEN_HEADER]: this.internalUsageToken
    }
  }

  /** Process-local proof that the request came from a Cherry-launched SDK subprocess. */
  isInternalAgentRequest(headers: Headers): boolean {
    return headers.get(INTERNAL_USAGE_TOKEN_HEADER) === this.internalUsageToken
  }

  /** Validated Agent session id from the internal usage headers; undefined for external requests. */
  getAgentSessionId(headers: Headers): string | undefined {
    if (!this.isInternalAgentRequest(headers)) return undefined
    return headers.get(AGENT_SESSION_ID_HEADER)?.trim() || undefined
  }

  /** Validate the process-local proof, then capture the reserved continuation or active turn. */
  resolveAgentSessionUsage(headers: Headers): InProcessUsageContext | undefined {
    const sessionId = this.getAgentSessionId(headers)
    if (!sessionId) return undefined
    return application.get('AgentSessionRuntimeService').getActiveUsageContext(sessionId)
  }
}
