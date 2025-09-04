import { IpcChannel } from '@shared/IpcChannel'
import { ApiServerConfig } from '@types'
import { ipcMain } from 'electron'

import { apiServer } from '../apiServer'
import { config } from '../apiServer/config'
import { loggerService } from './LoggerService'
const logger = loggerService.withContext('ApiServerService')

export class ApiServerService {
  constructor() {
    // Use the new clean implementation
  }

  async start(): Promise<void> {
    try {
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

  async getCurrentConfig(): Promise<ApiServerConfig> {
    return await config.get()
  }

  registerIpcHandlers(): void {
    // API Server
    ipcMain.handle(IpcChannel.ApiServer_Start, async () => {
      try {
        await this.start()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    ipcMain.handle(IpcChannel.ApiServer_Stop, async () => {
      try {
        await this.stop()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    ipcMain.handle(IpcChannel.ApiServer_Restart, async () => {
      try {
        await this.restart()
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      }
    })

    ipcMain.handle(IpcChannel.ApiServer_GetStatus, async () => {
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

    ipcMain.handle(IpcChannel.ApiServer_GetConfig, async () => {
      try {
        return await this.getCurrentConfig()
      } catch (error: any) {
        return null
      }
    })
  }
}

// Export singleton instance
export const apiServerService = new ApiServerService()
