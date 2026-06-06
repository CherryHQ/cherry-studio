import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { type Activatable, BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import type { ApiGatewayConfig, ApiGatewayStatusResult } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { ApiGateway } from './server'

const logger = loggerService.withContext('ApiGatewayService')

@Injectable('ApiGatewayService')
@ServicePhase(Phase.WhenReady)
export class ApiGatewayService extends BaseService implements Activatable {
  private apiGateway: ApiGateway | null = null
  /** Latest desired running state — the `enabled` preference, or the boot auto-start decision. */
  private desiredEnabled = false
  /**
   * True while a `reconcile()` loop is converging. `reconcile()` is the SOLE caller of
   * activate/deactivate — start/stop/restart route through it too — so transitions are
   * never concurrent and the lifecycle's `_activating` short-circuit can't race two
   * owners and leave the running state diverged from `desiredEnabled`.
   */
  private reconciling = false
  /** Error from the most recent transition, surfaced to the IPC start/stop/restart callers. */
  private lastTransitionError: unknown = null

  protected async onInit(): Promise<void> {
    this.registerIpcHandlers()
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange('feature.api_gateway.enabled', (enabled) => {
        this.desiredEnabled = enabled
        void this.reconcile()
      })
    )
  }

  protected async onReady(): Promise<void> {
    this.desiredEnabled = await this.shouldAutoStart()
    await this.reconcile()
  }

  /**
   * Converge the gateway's running state to `desiredEnabled`. Single-flight: a
   * re-entrant call (e.g. an opposing toggle that lands mid-transition) just updates
   * `desiredEnabled` and returns, and the running loop picks it up on its next pass.
   * It loops against the ACTUAL `isActivated` state, not the attempted target. A
   * transition that throws for a still-current target is recorded and not retried, so a
   * persistent failure (e.g. port in use) can't spin the loop.
   */
  private async reconcile(): Promise<void> {
    if (this.reconciling) return
    this.reconciling = true
    try {
      while (this.isActivated !== this.desiredEnabled) {
        const target = this.desiredEnabled
        this.lastTransitionError = null
        try {
          if (target) {
            await this.activate()
          } else {
            await this.deactivate()
          }
        } catch (error) {
          this.lastTransitionError = error
          logger.error(`API gateway ${target ? 'activation' : 'deactivation'} during reconcile failed`, error as Error)
          if (this.desiredEnabled === target) return
        }
      }
    } finally {
      this.reconciling = false
    }
  }

  async onActivate(): Promise<void> {
    try {
      await this.ensureValidApiKey()
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

  async start(): Promise<void> {
    // Set the desired state and converge through the single queue — never transition
    // directly, so this can't race an opposing reconcile (see `transitionQueue`).
    this.desiredEnabled = true
    await this.reconcile()
    if (!this.isActivated) {
      const error = this.failureError('Failed to start API Gateway')
      logger.error('Failed to start API Gateway:', error)
      throw error
    }
    logger.info('API Gateway started successfully')
  }

  async stop(): Promise<void> {
    this.desiredEnabled = false
    await this.reconcile()
    if (this.isActivated) {
      const error = this.failureError('Failed to stop API Gateway')
      logger.error('Failed to stop API Gateway:', error)
      throw error
    }
    logger.info('API Gateway stopped successfully')
  }

  async restart(): Promise<void> {
    // Re-create the server (e.g. to apply a new host/port) as a stop→start, so it goes
    // through the same single reconcile owner — no direct, race-prone transition.
    await this.stop()
    await this.start()
    logger.info('API Gateway restarted successfully')
  }

  /** Surface the recorded transition error to an IPC caller, or a generic fallback. */
  private failureError(fallback: string): Error {
    return this.lastTransitionError instanceof Error ? this.lastTransitionError : new Error(fallback)
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

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.ApiGateway_Start, async (): Promise<ApiGatewayStatusResult> => {
      try {
        await this.start()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    this.ipcHandle(IpcChannel.ApiGateway_Stop, async (): Promise<ApiGatewayStatusResult> => {
      try {
        await this.stop()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    this.ipcHandle(IpcChannel.ApiGateway_Restart, async (): Promise<ApiGatewayStatusResult> => {
      try {
        await this.restart()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    // NOTE: No status/config pull handlers. Running state is published to the
    // shared cache (Main authoritative; read via useSharedCache) and config
    // lives in the DataApi preference layer (feature.api_gateway.*) — pulling either
    // over IPC would be an anti-pattern.
  }

  private async shouldAutoStart(): Promise<boolean> {
    try {
      const config = this.getCurrentConfig()
      // Never log the raw API key — redact before emitting.
      logger.info('API gateway config:', { ...config, apiKey: config.apiKey ? '[redacted]' : null })

      if (config.enabled) {
        return true
      }

      try {
        const { total } = await agentService.listAgents({ limit: 1 })
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
