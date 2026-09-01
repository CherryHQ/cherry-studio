import { randomUUID } from 'node:crypto'

import type { McpServer as McpBridgeServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import { loggerService } from '@logger'
import { createMcpBridgeServer } from '@main/ai/mcp/createMcpBridgeServer'
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

/** Raised when a session is requested while the owning server is shutting down. */
export class StoreClosedError extends Error {
  constructor() {
    super('MCP session store is closed')
    this.name = 'StoreClosedError'
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
   * Initializations that passed admission but have not reached `onsessioninitialized` yet.
   * Counted against the cap: creation awaits `bridge.connect()` (and the route awaits cache
   * warming before that), so a burst of concurrent initializes would otherwise all read a
   * stale `sessions.size` and allocate unbounded bridges.
   */
  private pendingAdmissions = 0
  /** Set by `closeAll()`. A session opened after the server started closing would never be reachable. */
  private closed = false

  /**
   * Open a session for `server` and let it serve the `initialize` request that asked for one.
   * Creation and the first request are one step because the session id only exists once the
   * transport has processed that request — there is no meaningful half-built session to hand back.
   *
   * Throws {@link SessionLimitReachedError} when the cap is reached, or {@link StoreClosedError}
   * once the owning server is shutting down.
   */
  async createAndHandle(server: McpServer, request: Request, parsedBody: unknown): Promise<Response> {
    if (this.closed) throw new StoreClosedError()
    // Reserve synchronously — nothing may await between the check and the increment.
    if (this.sessions.size + this.pendingAdmissions >= MAX_SESSIONS) {
      throw new SessionLimitReachedError(MAX_SESSIONS)
    }
    this.pendingAdmissions++

    let registered = false
    const bridge = createMcpBridgeServer(server.id, server)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      // Responses stream as SSE rather than plain JSON: the SDK only writes
      // request-related notifications (tool `notifications/progress`) when JSON response
      // mode is OFF, so enabling it would resolve the call while silently dropping every
      // progress update. See `WebStandardStreamableHTTPServerTransport.send`.
      enableJsonResponse: false,
      onsessioninitialized: (sessionId) => {
        registered = true
        const session: McpSession = {
          id: sessionId,
          serverId: server.id,
          transport,
          bridge,
          lastActivityAt: Date.now()
        }
        // Outbound traffic counts as activity too. Without this the timestamp only moves on a
        // new HTTP request, so a client sitting on a GET stream and receiving notifications
        // would be swept as "idle" — a hard lifetime, not the idle timeout we document.
        const send = transport.send.bind(transport)
        transport.send = async (message, options) => {
          session.lastActivityAt = Date.now()
          return send(message, options)
        }
        this.sessions.set(sessionId, session)
        this.ensureSweeping()
        logger.debug('MCP session opened', { sessionId, serverId: server.id, live: this.sessions.size })
      },
      // The SDK's own DELETE path ends here, so the map can't outlive the transport.
      onsessionclosed: (sessionId) => {
        this.sessions.delete(sessionId)
        logger.debug('MCP session closed', { sessionId, live: this.sessions.size })
      }
    })

    try {
      await bridge.connect(transport)
      const response = await transport.handleRequest(request, { parsedBody })
      // `closeAll()` may have run while we were connecting; that sweep could not have seen
      // this session, so retire it here rather than leaving it behind a closed server.
      if (registered && this.closed) await this.delete(transport.sessionId!)
      return response
    } catch (error) {
      // A failed handshake registers nothing — drop the bridge rather than leak it.
      if (!registered) await bridge.close().catch(() => {})
      throw error
    } finally {
      this.pendingAdmissions--
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

  /**
   * Drop every session and stop sweeping, refusing new ones from here on.
   *
   * `ApiGateway.stop()` must call this **before** awaiting the HTTP server's close: a session's
   * GET stream is an active response, and Node's `server.close()` waits for those, so closing
   * in the other order deadlocks shutdown until the client disconnects.
   */
  async closeAll(): Promise<void> {
    this.closed = true
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
