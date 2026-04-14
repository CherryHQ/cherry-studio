import { loggerService } from '@logger'
import type { Disposable } from '@main/core/lifecycle'
import { toDataApiError } from '@shared/data/api/apiErrors'
import type { DataRequest, DataResponse } from '@shared/data/api/apiTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain } from 'electron'

import type { ApiServer } from '../ApiServer'

const logger = loggerService.withContext('DataApi:IpcAdapter')

/**
 * IPC transport adapter for Electron environment.
 *
 * ## Why a separate adapter instead of BaseService.ipcHandle()?
 *
 * ApiServer is designed as a transport-agnostic request processor — it only
 * knows DataRequest → DataResponse, with no dependency on Electron IPC.
 *
 * Adapters are the bridge between a specific transport and ApiServer:
 * - **IpcAdapter** (this file): bridges Electron IPC ↔ ApiServer
 * - **HttpAdapter** (planned): will bridge Express HTTP ↔ ApiServer
 *
 * If these handlers were registered directly via BaseService.ipcHandle() in
 * DataApiService, the transport-specific protocol conversion (error wrapping,
 * serialization) would leak into the coordinator, and adding a new transport
 * would require modifying DataApiService internals.
 *
 * Each adapter implements Disposable so DataApiService can track cleanup via
 * registerDisposable() — no manual teardown code needed.
 */
export class IpcAdapter implements Disposable {
  private initialized = false

  constructor(private apiServer: ApiServer) {}

  /**
   * Register IPC handlers to bridge renderer requests to ApiServer
   */
  setup(): void {
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
          error: apiError.toJSON(), // Serialize for IPC transmission
          metadata: {
            duration: 0,
            timestamp: Date.now()
          }
        }

        return errorResponse
      }
    })

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
   * Remove IPC handlers — implements Disposable for automatic lifecycle cleanup
   */
  dispose(): void {
    if (!this.initialized) {
      return
    }

    logger.debug('Removing IPC handlers...')

    ipcMain.removeHandler(IpcChannel.DataApi_Request)
    ipcMain.removeHandler(IpcChannel.DataApi_Subscribe)
    ipcMain.removeHandler(IpcChannel.DataApi_Unsubscribe)

    this.initialized = false
    logger.debug('IPC handlers removed')
  }
}
