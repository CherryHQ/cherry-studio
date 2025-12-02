import { preferenceService } from '@data/PreferenceService'
import { IpcChannel } from '@shared/IpcChannel'
import type {
  ApiServerConfig,
  GetApiServerStatusResult,
  RestartApiServerStatusResult,
  StartApiServerStatusResult,
  StopApiServerStatusResult
} from '@types'
import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'

import { apiServer } from '../apiServer'
import { loggerService } from './LoggerService'
const logger = loggerService.withContext('ApiServerService')

//FIXME v2 refactor: ApiServer的启动/停止，是否运行的逻辑，现在比较乱。特别是在v2的新数据架构下，需要进一步优化，现在仅仅是做了简单的替换
// 例如： 这样的warning：[mainWindow::PreferenceService] Attempted to confirm mismatched request for feature.csaas.enabled: expected req_1764650398717_0zb6wc350_feature.csaas.enabled, got req_1764650398704_41o5b5l1b_feature.csaas.enabled
export class ApiServerService {
  constructor() {
    // Use the new clean implementation
  }

  async start(): Promise<void> {
    try {
      // Ensure valid API key before starting
      await this.ensureValidApiKey()
      await apiServer.start()
      logger.info('API Server started successfully')
    } catch (error: any) {
      logger.error('Failed to start API Server:', error)
      throw error
    }
  }

  async stop(): Promise<void> {
    try {
      await apiServer.stop()
      logger.info('API Server stopped successfully')
    } catch (error: any) {
      logger.error('Failed to stop API Server:', error)
      throw error
    }
  }

  async restart(): Promise<void> {
    try {
      await apiServer.restart()
      logger.info('API Server restarted successfully')
    } catch (error: any) {
      logger.error('Failed to restart API Server:', error)
      throw error
    }
  }

  isRunning(): boolean {
    return apiServer.isRunning()
  }

  /**
   * Get current API server configuration from preference service
   */
  getCurrentConfig(): ApiServerConfig {
    const config = preferenceService.getMultipleRaw([
      'feature.csaas.enabled',
      'feature.csaas.host',
      'feature.csaas.port',
      'feature.csaas.api_key'
    ])

    return {
      enabled: config['feature.csaas.enabled'] ?? false,
      host: config['feature.csaas.host'] ?? 'localhost',
      port: config['feature.csaas.port'] ?? 23333,
      apiKey: config['feature.csaas.api_key'] ?? ''
    }
  }

  /**
   * Ensure a valid API key exists, generate one if null
   */
  async ensureValidApiKey(): Promise<string> {
    let apiKey = preferenceService.get('feature.csaas.api_key')
    if (apiKey === null) {
      apiKey = `cs-sk-${uuidv4()}`
      await preferenceService.set('feature.csaas.api_key', apiKey)
      logger.info('Generated new API key')
    }
    return apiKey
  }

  registerIpcHandlers(): void {
    // API Server
    ipcMain.handle(IpcChannel.ApiServer_Start, async (): Promise<StartApiServerStatusResult> => {
      try {
        await this.start()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    ipcMain.handle(IpcChannel.ApiServer_Stop, async (): Promise<StopApiServerStatusResult> => {
      try {
        await this.stop()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    ipcMain.handle(IpcChannel.ApiServer_Restart, async (): Promise<RestartApiServerStatusResult> => {
      try {
        await this.restart()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    ipcMain.handle(IpcChannel.ApiServer_GetStatus, (): GetApiServerStatusResult => {
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

    ipcMain.handle(IpcChannel.ApiServer_GetConfig, () => {
      try {
        return this.getCurrentConfig()
      } catch (error: any) {
        return null
      }
    })
  }
}

// Export singleton instance
export const apiServerService = new ApiServerService()
