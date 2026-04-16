/**
 * @fileoverview DataApiService - API coordination and orchestration (Main Process)
 *
 * NAMING NOTE:
 * This component is named "DataApiService" for management consistency, but it is
 * actually a coordinator/orchestrator rather than a business service.
 *
 * True Nature: API Coordinator / Orchestrator
 * - Initializes and coordinates the Data API framework
 * - Wires together ApiServer (routing) and IpcAdapter (IPC communication)
 * - Manages lifecycle (startup/shutdown) of API infrastructure
 * - Contains zero business logic - purely infrastructure plumbing
 *
 * Architecture:
 * DataApiService → coordinates → ApiServer + IpcAdapter
 * ApiServer → routes requests → Handlers → Services → DB
 * IpcAdapter → bridges → IPC ↔ ApiServer
 *
 * The "Service" suffix is kept for consistency with existing codebase conventions,
 * but developers should understand this is a coordinator, not a business service.
 *
 * @see {@link ApiServer} For request routing logic
 * @see {@link IpcAdapter} For IPC communication bridge
 */

import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, ServicePhase } from '@main/core/lifecycle'
import { Phase } from '@main/core/lifecycle'

import { ApiServer, IpcAdapter } from './api'
import { apiHandlers } from './api/handlers'

const logger = loggerService.withContext('DataApiService')

/**
 * Data API service for Electron environment
 * Coordinates the API server and IPC adapter
 */
@Injectable('DataApiService')
@ServicePhase(Phase.BeforeReady)
@DependsOn(['DbService'])
export class DataApiService extends BaseService {
  private apiServer: ApiServer
  private ipcAdapter: IpcAdapter

  constructor() {
    super()
    // Initialize ApiServer with handlers
    this.apiServer = ApiServer.initialize(apiHandlers)
    this.ipcAdapter = new IpcAdapter(this.apiServer)
  }

  protected async onInit(): Promise<void> {
    try {
      logger.info('Initializing Data API system...')

      // API handlers are already registered during ApiServer initialization
      logger.debug('API handlers initialized with type-safe routing')

      // Setup IPC adapter and register for automatic lifecycle cleanup
      this.ipcAdapter.setup()
      this.registerDisposable(this.ipcAdapter)

      logger.info('Data API system initialized successfully')

      // Log system info
      this.logSystemInfo()
    } catch (error) {
      logger.error('Failed to initialize Data API system', error as Error)
      throw error
    }
  }

  /**
   * Log system information for debugging
   */
  private logSystemInfo(): void {
    const systemInfo = this.apiServer.getSystemInfo()

    logger.info('Data API system ready', {
      server: systemInfo.server,
      version: systemInfo.version,
      handlers: systemInfo.handlers,
      middlewares: systemInfo.middlewares
    })
  }

  /**
   * Get system status and statistics
   */
  public getSystemStatus() {
    if (!this.isReady) {
      return {
        initialized: false,
        error: 'DataApiService not initialized'
      }
    }

    const systemInfo = this.apiServer.getSystemInfo()

    return {
      initialized: true,
      ...systemInfo
    }
  }

  /**
   * Get API server instance (for advanced usage)
   */
  public getApiServer(): ApiServer {
    return this.apiServer
  }
}
