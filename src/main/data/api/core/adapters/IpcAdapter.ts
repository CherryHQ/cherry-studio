import { loggerService } from '@logger'
import type { Disposable } from '@main/core/lifecycle'
import { validateSender } from '@main/core/security/validateSender'
import { isBackupInProgress } from '@main/data/db/backup/quiesceGate'
import { DataApiError, ERROR_STATUS_MAP, ErrorCode, toDataApiError } from '@shared/data/api/errors'
import type { DataRequest, DataResponse } from '@shared/data/api/types'
import { IpcChannel } from '@shared/IpcChannel'
import { ipcMain, type IpcMainInvokeEvent } from 'electron'

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

    // Main data request handler
    ipcMain.handle(IpcChannel.DataApi_Request, async (event, request: DataRequest): Promise<DataResponse> => {
      // Source-trust gate first: this channel funnels every business-data
      // capability, so verify the caller before touching the request.
      if (!this.isTrustedSender(event, `request ${request?.method} ${request?.path}`)) {
        const error = new DataApiError(ErrorCode.PERMISSION_DENIED, 'Untrusted IPC sender', 403)
        return {
          id: request?.id ?? '',
          status: error.status,
          error: error.toJSON(),
          metadata: {
            duration: 0,
            timestamp: Date.now()
          }
        }
      }

      // Partial restore quiesce: reject mutations while BACKUP_IN_PROGRESS is held.
      // GET (read) stays open — snapshot reads are safe; merge runs on detached work.sqlite.
      if (isBackupInProgress() && request.method !== 'GET') {
        const error = new DataApiError(
          ErrorCode.BACKUP_IN_PROGRESS,
          'backup: a restore is in progress — writes are paused until it completes',
          ERROR_STATUS_MAP[ErrorCode.BACKUP_IN_PROGRESS]
        )
        return {
          id: request?.id ?? '',
          status: error.status,
          error: error.toJSON(),
          metadata: {
            duration: 0,
            timestamp: Date.now()
          }
        }
      }

      try {
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

    this.initialized = true
  }

  /**
   * Source-trust gate for the DataApi IPC channels: only the app's own
   * top-level renderer frames pass (see `core/security/validateSender`). Rejections
   * are logged, not throttled — same stance as `IpcApiService.handleRequest`.
   */
  private isTrustedSender(event: IpcMainInvokeEvent, context: string): boolean {
    if (validateSender(event)) return true
    logger.warn(`Rejected DataApi ${context} from untrusted sender`, {
      senderType: event.sender.getType(),
      senderUrl: event.senderFrame?.url
    })
    return false
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

    this.initialized = false
    logger.debug('IPC handlers removed')
  }
}
