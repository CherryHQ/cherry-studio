import { IpcChannel } from '@shared/IpcChannel'
import type {
  ApiGatewayConfig,
  GetApiGatewayStatusResult,
  RestartApiGatewayStatusResult,
  StartApiGatewayStatusResult,
  StopApiGatewayStatusResult
} from '@types'
import { ipcMain } from 'electron'

import { apiGateway } from '../apiGateway'
import { config } from '../apiGateway/config'
import { loggerService } from './LoggerService'
const logger = loggerService.withContext('ApiGatewayService')

export class ApiGatewayService {
  constructor() {
    // Use the new clean implementation
  }

  async start(): Promise<void> {
    try {
      await apiGateway.start()
      logger.info('API Server started successfully')
    } catch (error: any) {
      logger.error('Failed to start API Server:', error)
      throw error
    }
  }

  async stop(): Promise<void> {
    try {
      await apiGateway.stop()
      logger.info('API Server stopped successfully')
    } catch (error: any) {
      logger.error('Failed to stop API Server:', error)
      throw error
    }
  }

  async restart(): Promise<void> {
    try {
      await apiGateway.restart()
      logger.info('API Server restarted successfully')
    } catch (error: any) {
      logger.error('Failed to restart API Server:', error)
      throw error
    }
  }

  isRunning(): boolean {
    return apiGateway.isRunning()
  }

  async getCurrentConfig(): Promise<ApiGatewayConfig> {
    return config.get()
  }

  registerIpcHandlers(): void {
    // API Server
    ipcMain.handle(IpcChannel.ApiGateway_Start, async (): Promise<StartApiGatewayStatusResult> => {
      try {
        await this.start()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    ipcMain.handle(IpcChannel.ApiGateway_Stop, async (): Promise<StopApiGatewayStatusResult> => {
      try {
        await this.stop()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    ipcMain.handle(IpcChannel.ApiGateway_Restart, async (): Promise<RestartApiGatewayStatusResult> => {
      try {
        await this.restart()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    ipcMain.handle(IpcChannel.ApiGateway_GetStatus, async (): Promise<GetApiGatewayStatusResult> => {
      try {
        const config = await this.getCurrentConfig()
        return {
          running: this.isRunning(),
          config
        }
      } catch (error: any) {
        return {
          running: this.isRunning(),
          config: null
        }
      }
    })

    ipcMain.handle(IpcChannel.ApiGateway_GetConfig, async () => {
      try {
        return this.getCurrentConfig()
      } catch (error: any) {
        return null
      }
    })
  }
}

// Export singleton instance
export const apiGatewayService = new ApiGatewayService()
