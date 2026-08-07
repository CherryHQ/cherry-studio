import { randomUUID } from 'node:crypto'

import { loggerService } from '@logger'
import { createMcpBridgeServer } from '@main/ai/mcp/createMcpBridgeServer'
import type { McpServer as McpBridgeServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import type { McpServer } from '@shared/data/types/mcpServer'

const logger = loggerService.withContext('McpSessionStore')

/** Matches the gateway's other long-lived stream budget (`GATEWAY_STREAM_IDLE_TIMEOUT_MS` in proxyStream.ts). */
const SESSION_IDLE_TIMEOUT_MS = 30 * 60_000
const SWEEP_INTERVAL_MS = 60_000
/** A client that never sends DELETE still gets swept, but a runaway one must not grow the map first. */
const MAX_SESSIONS = 64

export interface McpSession {
  id: string
  serverId: string
  transport: WebStandardStreamableHTTPServerTransport
  bridge: McpBridgeServer
  lastActivityAt: number
}

export class SessionLimitReachedError extends Error {
  constructor(limit: number) {
    super(`Too many MCP sessions (limit ${limit})`)
    this.name = 'SessionLimitReachedError'
  }
}

/**
 * Live `Mcp-Session-Id` → bridge/transport map for `/v1/mcps/:id/mcp`.
 *
 * Owned by `ApiGateway`, so session lifetime is exactly HTTP-server lifetime: once the
 * server closes, every session's socket is dead anyway, and `closeAll()` on the way down
 * is what keeps this from becoming v1's `transports` record — which was never evicted.
 *
 * Sessions are created only when a client opts in by sending `initialize`; the sessionless
 * one-shot path in `routes/mcp.ts` never reaches this store.
 */
export class McpSessionStore {
  private readonly sessions = new Map<string, McpSession>()
  private sweepTimer: NodeJS.Timeout | null = null

  /**
   * Open a session for `server` and let it serve the `initialize` request that asked for one.
   * Creation and the first request are one step because the session id only exists once the
   * transport has processed that request — there is no meaningful half-built session to hand back.
   *
   * Throws {@link SessionLimitReachedError} when the cap is reached.
   */
  async createAndHandle(server: McpServer, request: Request, parsedBody: unknown): Promise<Response> {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new SessionLimitReachedError(MAX_SESSIONS)
    }

    const bridge = createMcpBridgeServer(server.id, server)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      // POST replies stay plain JSON; server→client notifications ride the standalone
      // GET stream instead, which `handleGetRequest` opens regardless of this flag.
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        this.sessions.set(sessionId, {
          id: sessionId,
          serverId: server.id,
          transport,
          bridge,
          lastActivityAt: Date.now()
        })
        this.ensureSweeping()
        logger.debug('MCP session opened', { sessionId, serverId: server.id, live: this.sessions.size })
      },
      // The SDK's own DELETE path ends here, so the map can't outlive the transport.
      onsessionclosed: (sessionId) => {
        this.sessions.delete(sessionId)
        logger.debug('MCP session closed', { sessionId, live: this.sessions.size })
      }
    })

    await bridge.connect(transport)

    try {
      return await transport.handleRequest(request, { parsedBody })
    } catch (error) {
      // Nothing was registered if `initialize` failed — drop the bridge rather than leak it.
      if (!transport.sessionId || !this.sessions.has(transport.sessionId)) await bridge.close().catch(() => {})
      throw error
    }
  }

  /** Look up a live session, stamping it so the idle sweep leaves it alone. */
  get(sessionId: string): McpSession | undefined {
    const session = this.sessions.get(sessionId)
    if (session) session.lastActivityAt = Date.now()
    return session
  }

  async delete(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    await this.closeSession(session)
  }

  /** Drop every session and stop sweeping. Called by `ApiGateway.stop()`. */
  async closeAll(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
    const live = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(live.map((session) => this.closeSession(session)))
    if (live.length > 0) logger.info('Closed MCP sessions', { count: live.length })
  }

  get size(): number {
    return this.sessions.size
  }

  private async closeSession(session: McpSession): Promise<void> {
    // Closes the transport too, which ends any open SSE stream.
    await session.bridge
      .close()
      .catch((error) => logger.warn('Failed to close MCP session', { sessionId: session.id, error }))
  }

  private ensureSweeping(): void {
    if (this.sweepTimer) return
    this.sweepTimer = setInterval(() => void this.sweepIdle(), SWEEP_INTERVAL_MS)
    // Never hold the event loop open for a housekeeping timer.
    this.sweepTimer.unref?.()
  }

  private async sweepIdle(): Promise<void> {
    const deadline = Date.now() - SESSION_IDLE_TIMEOUT_MS
    const expired = [...this.sessions.values()].filter((session) => session.lastActivityAt < deadline)
    for (const session of expired) this.sessions.delete(session.id)
    await Promise.all(expired.map((session) => this.closeSession(session)))
    if (expired.length > 0) logger.info('Swept idle MCP sessions', { count: expired.length, live: this.sessions.size })
    if (this.sessions.size === 0 && this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }
}
