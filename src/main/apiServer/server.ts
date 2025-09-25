import { createServer } from 'node:http'

import { agentService } from '../services/agents'
import { loggerService } from '../services/LoggerService'
import { app } from './app'
import { config } from './config'

const logger = loggerService.withContext('ApiServer')

const GLOBAL_REQUEST_TIMEOUT_MS = 5 * 60_000
const GLOBAL_HEADERS_TIMEOUT_MS = GLOBAL_REQUEST_TIMEOUT_MS + 5_000
const GLOBAL_KEEPALIVE_TIMEOUT_MS = 60_000

export class ApiServer {
  private server: ReturnType<typeof createServer> | null = null

  async start(): Promise<void> {
    if (this.server) {
      logger.warn('Server already running')
      return
    }

    // Load config
    const { port, host } = await config.load()

    // Initialize AgentService
    logger.info('Initializing AgentService')
    await agentService.initialize()
    logger.info('AgentService initialized')

    // Create server with Express app
    this.server = createServer(app)
    this.applyServerTimeouts(this.server)

    // Start server
    return new Promise((resolve, reject) => {
      this.server!.listen(port, host, () => {
        logger.info('API server started', { host, port })
        resolve()
      })

      this.server!.on('error', reject)
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
    await config.reload()
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
