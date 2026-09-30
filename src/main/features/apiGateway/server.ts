import type { Server as HttpServer } from 'http'

import { application } from '@application'
import { loggerService } from '@logger'

import { buildApp } from './app'
import { McpSessionStore } from './McpSessionStore'

const logger = loggerService.withContext('ApiGateway')

const GLOBAL_REQUEST_TIMEOUT_MS = 5 * 60_000
const GLOBAL_HEADERS_TIMEOUT_MS = GLOBAL_REQUEST_TIMEOUT_MS + 5_000
const GLOBAL_KEEPALIVE_TIMEOUT_MS = 60_000
/** How long a still-running response may delay shutdown before its socket is destroyed. */
const SHUTDOWN_GRACE_MS = 3_000

// The Node adapter returns srvx internals, not the Bun server type exposed by Elysia.
type NodeServerInfo = {
  stop: () => Promise<unknown>
  raw: {
    node: { server: HttpServer }
    ready: () => Promise<unknown>
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
  private readonly servers: NodeServerInfo[] = []
  private boundPort?: number
  private readonly mcpSessions = new McpSessionStore()

  constructor(private readonly endpoint?: { host: string; port: number }) {}

  async start(): Promise<void> {
    if (this.isRunning()) return
    const preferences = application.get('PreferenceService')
    const port = this.endpoint?.port ?? preferences.get('feature.api_gateway.port')
    const host = this.endpoint?.host ?? preferences.get('feature.api_gateway.host')
    try {
      await this.listen(host, port)
      this.boundPort = this.getPort()
      try {
        await this.listen(host === '0.0.0.0' ? '::' : '::1', this.boundPort)
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EAFNOSUPPORT' && code !== 'EADDRNOTAVAIL') throw error
        logger.info('IPv6 unavailable; listening on IPv4 only', { code })
      }
      logger.info('API server started', { hosts: this.getHosts(), port: this.boundPort })
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  private async listen(host: string, port: number): Promise<void> {
    const app = buildApp({ host, port, mcpSessions: this.mcpSessions })
    // Explicit IPv6-only sockets avoid platform-dependent dual-stack defaults.
    const options = { port, hostname: host, reusePort: false, gracefulShutdown: false, node: { ipv6Only: true } }
    let created: NodeServerInfo | undefined
    try {
      const server = await new Promise<NodeServerInfo>((resolve, reject) => {
        app.listen(options, (server: NodeServerInfo) => {
          created = server
          this.applyServerTimeouts(server.raw.node.server)
          void server.raw.ready().then(() => resolve(server), reject)
        })
      })
      this.servers.push(server)
    } catch (error) {
      if (created) await this.closeHttpServer(created)
      throw error
    }
  }

  getHosts(): string[] {
    return this.servers.flatMap((server) => {
      const address = server.raw.node.server.address()
      return address && typeof address !== 'string' ? [address.address] : []
    })
  }

  getHost(): string | undefined {
    return this.getHosts()[0]
  }

  async rebind(host: string): Promise<void> {
    if (this.getHost() === host) return
    if (!this.servers.length || this.boundPort === undefined) throw new Error('API Gateway has no TCP listener')
    // Release listening handles only; existing local streams retain their sockets.
    for (const server of this.servers) {
      const http = server.raw.node.server
      if (http.listening) http.close()
    }
    try {
      for (const [index, server] of this.servers.entries()) {
        const address = index === 0 ? host : host === '0.0.0.0' ? '::' : '::1'
        const http = server.raw.node.server
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => {
            http.off('listening', onListening)
            reject(error)
          }
          const onListening = () => {
            http.off('error', onError)
            resolve()
          }
          http.once('error', onError)
          http.once('listening', onListening)
          http.listen({ port: this.boundPort, host: address, ipv6Only: true })
        })
      }
    } catch (error) {
      // A partially rebound pair must not leave an unreported network listener open.
      for (const server of this.servers) {
        const http = server.raw.node.server
        if (http.listening) http.close()
      }
      // A partially rebound pair must not leave an unreported network listener open.
      for (const server of this.servers) {
        const http = server.raw.node.server
        if (http.listening) http.close()
      }
      this.servers.length = 0
      throw error
    }
  }

  private applyServerTimeouts(server: HttpServer): void {
    server.requestTimeout = GLOBAL_REQUEST_TIMEOUT_MS
    server.headersTimeout = Math.max(GLOBAL_HEADERS_TIMEOUT_MS, server.requestTimeout + 1_000)
    server.keepAliveTimeout = GLOBAL_KEEPALIVE_TIMEOUT_MS
    server.setTimeout(0)
  }

  async stop(): Promise<void> {
    if (!this.servers.length) return
    try {
      // End MCP notification streams before waiting for their HTTP sockets to close.
      await this.mcpSessions.closeAll()
      await Promise.all(this.servers.map((server) => this.closeHttpServer(server)))
    } finally {
      this.servers.length = 0
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
  private async closeHttpServer(server: NodeServerInfo): Promise<void> {
    const http = server.raw.node.server
    if (!http.listening) http.closeAllConnections?.()
    // `stop()` must never reject: `onDeactivate` rethrows, which would strand the service activated.
    const closed = Promise.resolve(server.stop()).catch((error: unknown) =>
      logger.warn('API server close failed', error as Error)
    )
    if (await settledWithin(closed, SHUTDOWN_GRACE_MS)) return

    logger.warn('API server still has open connections after the grace period; destroying them')
    http.closeAllConnections?.()
    // Stop waiting either way — the port is already released, whatever the remaining sockets do.
    await settledWithin(closed, SHUTDOWN_GRACE_MS)
  }

  isRunning(): boolean {
    return this.servers.length > 0 && this.servers.every((server) => server.raw.node.server.listening)
  }

  getPort(): number {
    const address = this.servers[0]?.raw.node.server.address()
    if (!address || typeof address === 'string') throw new Error('API Gateway is not listening on a TCP port')
    return address.port
  }
}
