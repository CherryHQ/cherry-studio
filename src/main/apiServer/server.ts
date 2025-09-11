import { createServer } from 'node:http'

import { loggerService } from '../services/LoggerService'
import { app } from './app'
import { config } from './config'

const logger = loggerService.withContext('ApiServer')

export class ApiServer {
  private server: ReturnType<typeof createServer> | null = null

  async start(): Promise<void> {
    if (this.server) {
      logger.warn('Server already running')
      return
    }

    // Load config
    const { port, host, apiKey } = await config.load()

    // Create server with Express app
    this.server = createServer(app)

    // Start server
    return new Promise((resolve, reject) => {
      this.server!.listen(port, host, () => {
        logger.info(`API Server started at http://${host}:${port}`)
        logger.info(`API Key: ${apiKey}`)
        resolve()
      })

      this.server!.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return

    return new Promise((resolve) => {
      this.server!.close(() => {
        logger.info('API Server stopped')
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

    logger.debug('isRunning check:', { hasServer, isListening, result })

    return result
  }
}

export const apiServer = new ApiServer()
