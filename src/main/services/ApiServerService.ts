import { application } from '@application'
import { loggerService } from '@logger'
import { type Activatable, BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import type {
  ApiServerConfig,
  GetApiServerStatusResult,
  RestartApiServerStatusResult,
  StartApiServerStatusResult,
  StopApiServerStatusResult
} from '@types'
import { v4 as uuidv4 } from 'uuid'

import { ApiServer } from '../apiServer'
import { agentService } from './agents'

const logger = loggerService.withContext('ApiServerService')

@Injectable('ApiServerService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['MainWindowService'])
export class ApiServerService extends BaseService implements Activatable {
  private apiServer: ApiServer | null = null

  protected async onInit(): Promise<void> {
    this.registerIpcHandlers()
    // FIXME: Original code does not subscribe to feature.csaas.enabled runtime changes.
    // Start/stop is driven entirely by the renderer UI via IPC.
    // Consider adding a preference subscription for automatic runtime toggle in the future.
  }

  protected async onReady(): Promise<void> {
    const shouldStart = await this.shouldAutoStart()
    if (shouldStart) {
      await this.activate()
    }
  }

  async onActivate(): Promise<void> {
    try {
      await this.ensureValidApiKey()
      this.apiServer = new ApiServer()
      await this.apiServer.start()
      logger.info('API Server activated')
    } catch (error) {
      // Activatable failure contract: clean up partial state before throwing
      if (this.apiServer) {
        await this.apiServer.stop().catch(() => {})
        this.apiServer = null
      }
      throw error
    }
  }

  async onDeactivate(): Promise<void> {
    if (this.apiServer) {
      await this.apiServer.stop()
      this.apiServer = null
    }
    logger.info('API Server deactivated')
  }

  async start(): Promise<void> {
    try {
      await this.activate()
      logger.info('API Server started successfully')
    } catch (error: any) {
      logger.error('Failed to start API Server:', error)
      throw error
    }
  }

  async stop(): Promise<void> {
    try {
      await this.deactivate()
      logger.info('API Server stopped successfully')
    } catch (error: any) {
      logger.error('Failed to stop API Server:', error)
      throw error
    }
  }

  async restart(): Promise<void> {
    try {
      await this.deactivate()
      await this.activate()
      logger.info('API Server restarted successfully')
    } catch (error: any) {
      logger.error('Failed to restart API Server:', error)
      throw error
    }
  }

  isRunning(): boolean {
    return this.apiServer?.isRunning() ?? false
  }

  getCurrentConfig(): ApiServerConfig {
    const config = application.get('PreferenceService').getMultiple({
      enabled: 'feature.csaas.enabled',
      host: 'feature.csaas.host',
      port: 'feature.csaas.port',
      apiKey: 'feature.csaas.api_key'
    }) as ApiServerConfig

    return config
  }

  async ensureValidApiKey(): Promise<string> {
    const preferenceService = application.get('PreferenceService')
    let apiKey = preferenceService.get('feature.csaas.api_key')
    if (apiKey === null) {
      apiKey = `cs-sk-${uuidv4()}`
      await preferenceService.set('feature.csaas.api_key', apiKey)
      logger.info('Generated new API key')
    }
    return apiKey
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.ApiServer_Start, async (): Promise<StartApiServerStatusResult> => {
      try {
        await this.start()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    this.ipcHandle(IpcChannel.ApiServer_Stop, async (): Promise<StopApiServerStatusResult> => {
      try {
        await this.stop()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    this.ipcHandle(IpcChannel.ApiServer_Restart, async (): Promise<RestartApiServerStatusResult> => {
      try {
        await this.restart()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    this.ipcHandle(IpcChannel.ApiServer_GetStatus, (): GetApiServerStatusResult => {
      try {
        const config = this.getCurrentConfig()
        return {
          running: this.isRunning(),
          config
        }
      } catch (error: any) {
        logger.error('IpcChannel.ApiServer_GetStatus', error as Error)
        return {
          running: this.isRunning(),
          config: null
        }
      }
    })

    this.ipcHandle(IpcChannel.ApiServer_GetConfig, () => {
      try {
        return this.getCurrentConfig()
      } catch (error: any) {
        return null
      }
    })
  }

  private async shouldAutoStart(): Promise<boolean> {
    try {
      const config = this.getCurrentConfig()
      logger.info('API server config:', config)

      if (config.enabled) {
        return true
      }

      try {
        const { total } = await agentService.listAgents({ limit: 1 })
        if (total > 0) {
          logger.info(`Detected ${total} agent(s), auto-starting API server`)
          return true
        }
      } catch (error: any) {
        logger.warn('Failed to check agent count:', error)
      }

      return false
    } catch (error: any) {
      logger.error('Failed to check API server auto-start condition:', error)
      return false
    }
  }
}
