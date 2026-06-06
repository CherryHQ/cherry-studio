import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { type Activatable, BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import type { ApiGatewayConfig, ApiGatewayStatusResult } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { ApiGateway } from '../server'

const logger = loggerService.withContext('ApiGatewayService')

@Injectable('ApiGatewayService')
@ServicePhase(Phase.WhenReady)
export class ApiGatewayService extends BaseService implements Activatable {
  private apiGateway: ApiGateway | null = null
  /** Latest desired running state — the `enabled` preference, or the boot auto-start decision. */
  private desiredEnabled = false
  /** True while `reconcile()` is converging; re-entrant callers just update `desiredEnabled`. */
  private reconciling = false

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
   * Converge the gateway's running state to `desiredEnabled`. The lifecycle's
   * `activate`/`deactivate` short-circuit while a transition is in flight (`_activating`),
   * which would silently drop an opposing toggle that lands during the boot bind window.
   * Rather than a queue, this re-reads `desiredEnabled` after each transition settles: a
   * re-entrant call just updates the desired state and returns, and the running loop picks
   * it up. A transition that throws is logged and NOT retried for the same target, so a
   * persistent failure (e.g. port in use) can't spin the loop.
   */
  private async reconcile(): Promise<void> {
    if (this.reconciling) return
    this.reconciling = true
    try {
      let applied: boolean | undefined
      while (applied !== this.desiredEnabled) {
        const target = this.desiredEnabled
        try {
          if (target) {
            await this.activate()
          } else {
            await this.deactivate()
          }
        } catch (error) {
          logger.error(`API gateway ${target ? 'activation' : 'deactivation'} during reconcile failed`, error as Error)
        }
        applied = target
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
    try {
      // Keep the desired state coherent so a later reconcile() doesn't undo this.
      this.desiredEnabled = true
      await this.activate()
      logger.info('API Gateway started successfully')
    } catch (error: any) {
      logger.error('Failed to start API Gateway:', error)
      throw error
    }
  }

  async stop(): Promise<void> {
    try {
      this.desiredEnabled = false
      await this.deactivate()
      logger.info('API Gateway stopped successfully')
    } catch (error: any) {
      logger.error('Failed to stop API Gateway:', error)
      throw error
    }
  }

  async restart(): Promise<void> {
    try {
      this.desiredEnabled = true
      await this.deactivate()
      await this.activate()
      logger.info('API Gateway restarted successfully')
    } catch (error: any) {
      logger.error('Failed to restart API Gateway:', error)
      throw error
    }
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
