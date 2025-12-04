import { createServer } from 'node:http'

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'

import { windowService } from '../services/WindowService'
import { app } from './app'

const logger = loggerService.withContext('ApiServer')

const GLOBAL_REQUEST_TIMEOUT_MS = 5 * 60_000
const GLOBAL_HEADERS_TIMEOUT_MS = GLOBAL_REQUEST_TIMEOUT_MS + 5_000
const GLOBAL_KEEPALIVE_TIMEOUT_MS = 60_000

export class ApiServer {
  private server: ReturnType<typeof createServer> | null = null

  async start(): Promise<void> {
    if (this.server && this.server.listening) {
      logger.warn('Server already running')
      return
    }

    // Clean up any failed server instance
    if (this.server && !this.server.listening) {
      logger.warn('Cleaning up failed server instance')
      this.server = null
    }

    // Load config from preference service
    const port = preferenceService.get('feature.csaas.port')
    const host = preferenceService.get('feature.csaas.host')

    // Create server with Express app
    this.server = createServer(app)
    this.applyServerTimeouts(this.server)

    // Start server
    return new Promise((resolve, reject) => {
      this.server!.listen(port, host, () => {
        logger.info('API server started', { host, port })

        // Notify renderer that API server is ready
        const mainWindow = windowService.getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IpcChannel.ApiServer_Ready)
        }

        resolve()
      })

      this.server!.on('error', (error) => {
        // Clean up the server instance if listen fails
        this.server = null
        reject(error)
      })
    })
  }

  private applyServerTimeouts(server: ReturnType<typeof createServer>): void {
    server.requestTimeout = GLOBAL_REQUEST_TIMEOUT_MS
    server.headersTimeout = Math.max(GLOBAL_HEADERS_TIMEOUT_MS, server.requestTimeout + 1_000)
    server.keepAliveTimeout = GLOBAL_KEEPALIVE_TIMEOUT_MS
    server.setTimeout(0)
  }

  async stop(): Promise<void> {
    if (!this.server) return

    return new Promise((resolve) => {
      this.server!.close(() => {
        logger.info('API server stopped')
        this.server = null
        resolve()
      })
    })
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  isRunning(): boolean {
    const hasServer = this.server !== null
    const isListening = this.server?.listening || false
    const result = hasServer && isListening

    logger.debug('isRunning check', { hasServer, isListening, result })

    return result
  }
}

export const apiServer = new ApiServer()
