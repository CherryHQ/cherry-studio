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

import { ApiServer, IpcAdapter } from './api'
import { apiHandlers } from './api/handlers'

const logger = loggerService.withContext('DataApiService')

/**
 * Data API service for Electron environment
 * Coordinates the API server and IPC adapter
 */
class DataApiService {
  private static instance: DataApiService
  private initialized = false
  private apiServer: ApiServer
  private ipcAdapter: IpcAdapter

  private constructor() {
    // Initialize ApiServer with handlers
    this.apiServer = ApiServer.initialize(apiHandlers)
    this.ipcAdapter = new IpcAdapter(this.apiServer)
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): DataApiService {
    if (!DataApiService.instance) {
      DataApiService.instance = new DataApiService()
    }
    return DataApiService.instance
  }

  /**
   * Initialize the Data API system
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('DataApiService already initialized')
      return
    }

    try {
      logger.info('Initializing Data API system...')

      // API handlers are already registered during ApiServer initialization
      logger.debug('API handlers initialized with type-safe routing')

      // Setup IPC handlers
      this.ipcAdapter.setupHandlers()

      this.initialized = true
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
    if (!this.initialized) {
      return {
        initialized: false,
        error: 'DataApiService not initialized'
      }
    }

    const systemInfo = this.apiServer.getSystemInfo()

    return {
      initialized: true,
      ipcInitialized: this.ipcAdapter.isInitialized(),
      ...systemInfo
    }
  }

  /**
   * Get API server instance (for advanced usage)
   */
  public getApiServer(): ApiServer {
    return this.apiServer
  }

  /**
   * Shutdown the Data API system
   */
  public async shutdown(): Promise<void> {
    if (!this.initialized) {
      return
    }

    try {
      logger.info('Shutting down Data API system...')

      // Remove IPC handlers
      this.ipcAdapter.removeHandlers()

      this.initialized = false
      logger.info('Data API system shutdown complete')
    } catch (error) {
      logger.error('Error during Data API shutdown', error as Error)
      throw error
    }
  }
}

// Export singleton instance
export const dataApiService = DataApiService.getInstance()
