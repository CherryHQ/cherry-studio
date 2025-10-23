import { loggerService } from '@logger'
import type { DataRequest, DataResponse } from '@shared/data/api/apiTypes'
import { toDataApiError } from '@shared/data/api/errorCodes'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'

import type { ApiServer } from '../ApiServer'

const logger = loggerService.withContext('DataApiIpcAdapter')

/**
 * IPC Adapter for Electron environment
 * Handles IPC communication and forwards requests to ApiServer
 */
export class IpcAdapter {
  private initialized = false

  constructor(private apiServer: ApiServer) {}

  /**
   * Setup IPC handlers
   */
  setupHandlers(): void {
    if (this.initialized) {
      logger.warn('IPC handlers already initialized')
      return
    }

    logger.debug('Setting up IPC handlers...')

    // Main data request handler
    ipcMain.handle(IpcChannel.DataApi_Request, async (_event, request: DataRequest): Promise<DataResponse> => {
      try {
        logger.debug(`Handling data request: ${request.method} ${request.path}`, {
          id: request.id,
          params: request.params
        })

        const response = await this.apiServer.handleRequest(request)

        return response
      } catch (error) {
        logger.error(`Data request failed: ${request.method} ${request.path}`, error as Error)

        const apiError = toDataApiError(error, `${request.method} ${request.path}`)
        const errorResponse: DataResponse = {
          id: request.id,
          status: apiError.status,
          error: apiError,
          metadata: {
            duration: 0,
            timestamp: Date.now()
          }
        }

        return errorResponse
      }
    })

    // Batch request handler
    ipcMain.handle(IpcChannel.DataApi_Batch, async (_event, batchRequest: DataRequest): Promise<DataResponse> => {
      try {
        logger.debug('Handling batch request', { requestCount: batchRequest.body?.requests?.length })

        const response = await this.apiServer.handleBatchRequest(batchRequest)
        return response
      } catch (error) {
        logger.error('Batch request failed', error as Error)

        const apiError = toDataApiError(error, 'batch request')
        return {
          id: batchRequest.id,
          status: apiError.status,
          error: apiError,
          metadata: {
            duration: 0,
            timestamp: Date.now()
          }
        }
      }
    })

    // Transaction handler (placeholder)
    ipcMain.handle(
      IpcChannel.DataApi_Transaction,
      async (_event, transactionRequest: DataRequest): Promise<DataResponse> => {
        try {
          logger.debug('Handling transaction request')

          // TODO: Implement transaction support
          throw new Error('Transaction support not yet implemented')
        } catch (error) {
          logger.error('Transaction request failed', error as Error)

          const apiError = toDataApiError(error, 'transaction request')
          return {
            id: transactionRequest.id,
            status: apiError.status,
            error: apiError,
            metadata: {
              duration: 0,
              timestamp: Date.now()
            }
          }
        }
      }
    )

    // Subscription handlers (placeholder for future real-time features)
    ipcMain.handle(IpcChannel.DataApi_Subscribe, async (_event, path: string) => {
      logger.debug(`Data subscription request: ${path}`)
      // TODO: Implement real-time subscriptions
      return { success: true, subscriptionId: `sub_${Date.now()}` }
    })

    ipcMain.handle(IpcChannel.DataApi_Unsubscribe, async (_event, subscriptionId: string) => {
      logger.debug(`Data unsubscription request: ${subscriptionId}`)
      // TODO: Implement real-time subscriptions
      return { success: true }
    })

    this.initialized = true
    logger.debug('IPC handlers setup complete')
  }

  /**
   * Remove IPC handlers
   */
  removeHandlers(): void {
    if (!this.initialized) {
      return
    }

    logger.debug('Removing IPC handlers...')

    ipcMain.removeHandler(IpcChannel.DataApi_Request)
    ipcMain.removeHandler(IpcChannel.DataApi_Batch)
    ipcMain.removeHandler(IpcChannel.DataApi_Transaction)
    ipcMain.removeHandler(IpcChannel.DataApi_Subscribe)
    ipcMain.removeHandler(IpcChannel.DataApi_Unsubscribe)

    this.initialized = false
    logger.debug('IPC handlers removed')
  }

  /**
   * Check if handlers are initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }
}
