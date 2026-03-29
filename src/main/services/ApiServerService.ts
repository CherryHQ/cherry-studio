import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
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
import { loggerService } from './LoggerService'

const logger = loggerService.withContext('ApiServerService')

//FIXME v2 refactor: ApiServer的启动/停止，是否运行的逻辑，现在比较乱。特别是在v2的新数据架构下，需要进一步优化，现在仅仅是做了简单的替换
// 例如： 这样的warning：[mainWindow::PreferenceService] Attempted to confirm mismatched request for feature.csaas.enabled: expected req_1764650398717_0zb6wc350_feature.csaas.enabled, got req_1764650398704_41o5b5l1b_feature.csaas.enabled
@Injectable('ApiServerService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowService'])
export class ApiServerService extends BaseService {
  private apiServer = new ApiServer()

  protected async onInit(): Promise<void> {
    this.registerIpcHandlers()
  }

  protected async onStop(): Promise<void> {
    await this.apiServer.stop()
    logger.info('API Server stopped via lifecycle')
  }

  protected async onAllReady(): Promise<void> {
    await this.autoStartIfNeeded()
  }

  async start(): Promise<void> {
    try {
      await this.ensureValidApiKey()
      await this.apiServer.start()
      logger.info('API Server started successfully')
    } catch (error: any) {
      logger.error('Failed to start API Server:', error)
      throw error
    }
  }

  async stop(): Promise<void> {
    try {
      await this.apiServer.stop()
      logger.info('API Server stopped successfully')
    } catch (error: any) {
      logger.error('Failed to stop API Server:', error)
      throw error
    }
  }

  async restart(): Promise<void> {
    try {
      await this.apiServer.restart()
      logger.info('API Server restarted successfully')
    } catch (error: any) {
      logger.error('Failed to restart API Server:', error)
      throw error
    }
  }

  isRunning(): boolean {
    return this.apiServer.isRunning()
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

  private async autoStartIfNeeded(): Promise<void> {
    try {
      const config = this.getCurrentConfig()
      logger.info('API server config:', config)

      let shouldStart = config.enabled
      if (!shouldStart) {
        try {
          const { total } = await agentService.listAgents({ limit: 1 })
          if (total > 0) {
            shouldStart = true
            logger.info(`Detected ${total} agent(s), auto-starting API server`)
          }
        } catch (error: any) {
          logger.warn('Failed to check agent count:', error)
        }
      }

      if (shouldStart) {
        await this.start()
      }
    } catch (error: any) {
      logger.error('Failed to check/start API server:', error)
    }
  }
}
