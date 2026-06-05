import { application } from '@application'
import { loggerService } from '@logger'
import type { Server } from 'http'

import { type ApiGatewayApp, buildApp } from './app'

const logger = loggerService.withContext('ApiGateway')

const GLOBAL_REQUEST_TIMEOUT_MS = 5 * 60_000
const GLOBAL_HEADERS_TIMEOUT_MS = GLOBAL_REQUEST_TIMEOUT_MS + 5_000
const GLOBAL_KEEPALIVE_TIMEOUT_MS = 60_000

/** Minimal shape of the `serverInfo` object returned by `@elysia/node`'s listen callback. */
interface NodeServerInfo {
  raw?: {
    node?: {
      // Node's `http.Server` — exposes the timeout knobs we set below.
      server?: Server
    }
    // srvx `NodeServer` instance: `ready()` resolves once listening (rejects on EADDRINUSE etc.).
    ready?: () => Promise<unknown>
  }
  stop?: () => unknown
}

export class ApiGateway {
  private app: ApiGatewayApp | null = null
  private serverInfo: NodeServerInfo | null = null
  private running = false

  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Server already running')
      return
    }

    // Load config from preference service
    const preferenceService = application.get('PreferenceService')
    const port = preferenceService.get('feature.csaas.port')
    const host = preferenceService.get('feature.csaas.host')

    const app = buildApp()
    this.app = app

    return new Promise((resolve, reject) => {
      try {
        app.listen({ port, hostname: host }, (serverInfo) => {
          const info = serverInfo as unknown as NodeServerInfo
          this.serverInfo = info

          const http = info?.raw?.node?.server
          if (http) {
            this.applyServerTimeouts(http)
          }

          // The listen callback fires synchronously before the socket is bound;
          // await the underlying NodeServer's `ready()` to surface listen errors
          // (e.g. EADDRINUSE), mirroring the previous Express `'error'` handling.
          const ready = info?.raw?.ready
          if (typeof ready === 'function') {
            ready
              .call(info.raw)
              .then(() => {
                this.running = true
                logger.info('API server started', { host, port })
                resolve()
              })
              .catch((error: unknown) => {
                this.cleanupFailedStart()
                reject(error instanceof Error ? error : new Error(String(error)))
              })
          } else {
            this.running = true
            logger.info('API server started', { host, port })
            resolve()
          }
        })
      } catch (error) {
        this.cleanupFailedStart()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private applyServerTimeouts(server: Server): void {
    server.requestTimeout = GLOBAL_REQUEST_TIMEOUT_MS
    server.headersTimeout = Math.max(GLOBAL_HEADERS_TIMEOUT_MS, server.requestTimeout + 1_000)
    server.keepAliveTimeout = GLOBAL_KEEPALIVE_TIMEOUT_MS
    server.setTimeout(0)
  }

  private cleanupFailedStart(): void {
    this.running = false
    this.serverInfo = null
    this.app = null
  }

  async stop(): Promise<void> {
    if (!this.app && !this.serverInfo) return

    try {
      // Close the underlying Node http server.
      this.serverInfo?.stop?.()
      await this.app?.stop?.()
    } finally {
      this.running = false
      this.serverInfo = null
      this.app = null
      logger.info('API server stopped')
    }
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  isRunning(): boolean {
    const http = this.serverInfo?.raw?.node?.server
    const result = this.running && (http?.listening ?? true)
    logger.debug('isRunning check', { running: this.running, listening: http?.listening, result })
    return result
  }
}
