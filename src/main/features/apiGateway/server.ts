import { application } from '@application'
import { loggerService } from '@logger'
import type { Server } from 'elysia/universal/server'
import type { Server as HttpServer } from 'http'

import { type ApiGatewayApp, buildApp } from './app'

const logger = loggerService.withContext('ApiGateway')

const GLOBAL_REQUEST_TIMEOUT_MS = 5 * 60_000
const GLOBAL_HEADERS_TIMEOUT_MS = GLOBAL_REQUEST_TIMEOUT_MS + 5_000
const GLOBAL_KEEPALIVE_TIMEOUT_MS = 60_000

/**
 * `@elysia/node` resolves the listen callback's argument to Elysia's Bun-shaped
 * `Server` (which provides `stop()`), but at runtime hands back a srvx-backed object
 * that also carries `.raw` internals not present in that type. We widen the real
 * `Server` with exactly the `.raw` shape we read — so no cast is needed.
 */
type NodeServerInfo = Server & {
  raw?: {
    // Node's `http.Server` — exposes the timeout knobs we set below.
    node?: { server?: HttpServer }
    // srvx `NodeServer`: `ready()` resolves once listening (rejects on EADDRINUSE etc.).
    ready?: () => Promise<unknown>
  }
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
    const port = preferenceService.get('feature.api_gateway.port')
    const host = preferenceService.get('feature.api_gateway.host')

    const app = buildApp()
    this.app = app

    return new Promise((resolve, reject) => {
      try {
        app.listen({ port, hostname: host }, (serverInfo: NodeServerInfo) => {
          this.serverInfo = serverInfo

          const http = serverInfo.raw?.node?.server
          if (http) {
            this.applyServerTimeouts(http)
          }

          // The listen callback fires synchronously before the socket is bound;
          // await the underlying NodeServer's `ready()` to surface listen errors
          // (e.g. EADDRINUSE), mirroring the previous Express `'error'` handling.
          const ready = serverInfo.raw?.ready
          if (typeof ready === 'function') {
            ready
              .call(serverInfo.raw)
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

  private applyServerTimeouts(server: HttpServer): void {
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
      // Close the underlying Node http server. `serverInfo.stop()` returns
      // `server.close()` (the authoritative port release) — await it.
      //
      // Do NOT call `app.stop()` here: with the `@elysia/node` adapter, `listen()`
      // never assigns `app.server`, so Elysia core's web-standard `stop()` throws
      // "Elysia isn't running". An unhandled throw would skip the cleanup below and
      // leave the service stuck `_activated` with a stale `running` cache state.
      await this.serverInfo?.stop?.()
    } finally {
      this.running = false
      this.serverInfo = null
      this.app = null
      logger.info('API server stopped')
    }
  }

  isRunning(): boolean {
    const http = this.serverInfo?.raw?.node?.server
    const result = this.running && (http?.listening ?? true)
    logger.debug('isRunning check', { running: this.running, listening: http?.listening, result })
    return result
  }
}
