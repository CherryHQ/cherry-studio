import { application } from '@application'
import { loggerService } from '@logger'
import type { Server } from 'elysia/universal/server'
import type { Server as HttpServer } from 'http'

import { type ApiGatewayApp, buildApp } from './app'
import { McpSessionStore } from './McpSessionStore'

const logger = loggerService.withContext('ApiGateway')

const GLOBAL_REQUEST_TIMEOUT_MS = 5 * 60_000
const GLOBAL_HEADERS_TIMEOUT_MS = GLOBAL_REQUEST_TIMEOUT_MS + 5_000
const GLOBAL_KEEPALIVE_TIMEOUT_MS = 60_000
/** How long a still-running response may delay shutdown before its socket is destroyed. */
const SHUTDOWN_GRACE_MS = 3_000

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

/** Resolves `true` if `promise` settled within `ms`, `false` on timeout — the promise keeps running. */
function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    timer.unref?.()
    void promise.then(() => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

export class ApiGateway {
  private app: ApiGatewayApp | null = null
  private serverInfo: NodeServerInfo | null = null
  private running = false
  /**
   * Owned here so session lifetime is exactly server lifetime: once the socket closes every
   * session is unreachable, so `stop()` must drop them rather than leak bridges into the next
   * activation (a restart builds a fresh `ApiGateway`, and a port change is a stop→start).
   */
  private readonly mcpSessions = new McpSessionStore()

  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Server already running')
      return
    }

    // Load config from preference service
    const preferenceService = application.get('PreferenceService')
    const port = preferenceService.get('feature.api_gateway.port')
    const host = preferenceService.get('feature.api_gateway.host')

    const app = buildApp({ host, port, mcpSessions: this.mcpSessions })
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
      // Do NOT call `app.stop()` here: with the `@elysia/node` adapter, `listen()`
      // never assigns `app.server`, so Elysia core's web-standard `stop()` throws
      // "Elysia isn't running". An unhandled throw would skip the cleanup below and
      // leave the service stuck `_activated` with a stale `running` cache state.
      // BEFORE awaiting the close, not after: a session's GET stream is an active response,
      // and `server.close()` waits for those to finish, so stopping first would hang here
      // until the client disconnected or the idle sweep fired half an hour later. Closing the
      // sessions ends those streams, which is what lets the close below settle. `closeAll`
      // also latches the store shut, so an initialize racing this shutdown is refused.
      await this.mcpSessions.closeAll()
      await this.closeHttpServer()
    } finally {
      this.running = false
      this.serverInfo = null
      this.app = null
      logger.info('API server stopped')
    }
  }

  /**
   * Close the underlying Node http server, destroying leftover sockets once the grace period is up.
   *
   * `close()` releases the listening handle at once but only settles when the last connection ends.
   * A proxied SSE response is exactly such a connection and may never end on its own — the socket
   * timeout is disabled — so awaiting it alone leaves the user's off switch spinning forever.
   */
  private async closeHttpServer(): Promise<void> {
    const http = this.serverInfo?.raw?.node?.server
    // `stop()` must never reject: `onDeactivate` rethrows, which would strand the service activated.
    const closed = Promise.resolve(this.serverInfo?.stop?.()).catch((error: unknown) =>
      logger.warn('API server close failed', error as Error)
    )
    if (await settledWithin(closed, SHUTDOWN_GRACE_MS)) return

    logger.warn('API server still has open connections after the grace period; destroying them')
    http?.closeAllConnections?.()
    // Stop waiting either way — the port is already released, whatever the remaining sockets do.
    await settledWithin(closed, SHUTDOWN_GRACE_MS)
  }

  isRunning(): boolean {
    const http = this.serverInfo?.raw?.node?.server
    const result = this.running && (http?.listening ?? true)
    logger.debug('isRunning check', { running: this.running, listening: http?.listening, result })
    return result
  }
}
