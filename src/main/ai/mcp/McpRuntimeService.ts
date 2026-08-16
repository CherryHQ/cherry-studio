import crypto from 'node:crypto'
import fs from 'node:fs/promises'

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Emitter, type Event, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { TraceMethod, withSpanFunc } from '@mcp-trace/trace-core'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp'
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { GetPromptResult, Progress } from '@modelcontextprotocol/sdk/types.js'
import { isMcpToolDisabledBySource } from '@shared/ai/tools/mcpSourcePolicy'
import type { SharedCacheKey } from '@shared/data/cache/cacheSchemas'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import type { McpServer, McpServerType } from '@shared/data/types/mcpServer'
import type { McpServerLogEntry } from '@shared/types/mcp'
import type { McpPrompt, McpResource } from '@shared/types/mcp'
import { safeSerialize } from '@shared/utils/serialize'
import { app } from 'electron'
import { EventEmitter } from 'events'
import { nanoid } from 'nanoid'
import { v4 as uuidv4 } from 'uuid'
import * as z from 'zod'

import { isMcpCancellation } from './mcpAbort'
import {
  getTransportCandidates,
  isTransportFallbackError,
  loadMcpClientSdk,
  type McpClientSdk,
  type McpTransport
} from './mcpClientSdk'
import type { McpPackageService } from './McpPackageService'
import { redactCacheKey, redactSensitive, redactServerKey } from './mcpRedact'
import { createTransport } from './mcpTransport'
import { CallBackServer } from './oauth/callback'
import { McpOAuthClientProvider } from './oauth/provider'
import { ServerLogBuffer } from './ServerLogBuffer'
import type { GetResourceResponse, McpCallToolResponse } from './types'

function getAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('MCP tool call aborted', 'AbortError')
}

// Generic type for caching wrapped functions
type CachedFunction<T extends unknown[], R> = (...args: T) => Promise<R>

type CallToolArgs = {
  serverId: string
  name: string
  args: any
  callId?: string
  /** Caller-isolation key (e.g. topicId) — abort-by-id only matches within the same scope. */
  scope?: string
  signal?: AbortSignal
  /**
   * Receives the upstream server's progress notifications. The renderer gets them
   * unconditionally over IPC, so this is for callers outside it — currently the MCP bridge,
   * relaying to a client that supplied a `progressToken`.
   */
  onProgress?: ProgressCallback
}
type RuntimeCallToolArgs = {
  server: McpServer
  name: string
  args: any
  callId?: string
  scope?: string
  signal?: AbortSignal
  onProgress?: ProgressCallback
}

/**
 * Registration key for `activeToolCalls`. AI SDK call ids are not process-wide unique
 * (providers may reuse ids like "call_0" across topics), so a scoped caller's key is
 * namespaced and an explicit abort must present the same scope — cancellation never
 * reaches across scopes. NUL can occur in neither id, so the composite is unambiguous.
 */
function toolCallKey(callId: string, scope?: string): string {
  return scope ? `${scope}\u0000${callId}` : callId
}

type ProgressCallback = (progress: Progress) => void
type McpRuntimeState = McpRuntimeStatus['state']

// IPC payload validation for the renderer-facing handlers. The inner `args` are the tool/prompt
// arguments forwarded to the MCP server (server-trusted by protocol), so only the wrapper fields
// are validated; this rejects a malformed/typo'd renderer payload before it reaches the runtime.
const NonEmptyStringSchema = z.string().min(1)
export const McpCallToolPayloadSchema = z.object({
  serverId: z.string().min(1),
  name: z.string().min(1),
  args: z.unknown().optional(),
  callId: z.string().optional()
})
export const McpGetResourcePayloadSchema = z.object({
  serverId: z.string().min(1),
  uri: z.string().min(1)
})
export const McpStringArgSchema = NonEmptyStringSchema

const logger = loggerService.withContext('McpRuntimeService')
const mcpStatusCacheKey = (serverId: string): SharedCacheKey => `mcp.status.${serverId}` as SharedCacheKey

export interface McpToolListChangedEvent {
  serverId: string
}

// Minimum timeout for the MCP `initialize` request. Connect runs once per activation,
// so a generous floor avoids false positives on slow SSE/streamableHttp handshakes while
// still letting users raise it further via `server.timeout`.
const MCP_CONNECT_TIMEOUT_FLOOR_MS = 180_000

// Liveness ping before reusing a cached client. 1s falsely timed out on stdio servers busy
// with a previous request, forcing needless reconnects.
const PING_TIMEOUT_MS = 5_000

// Create a context-aware logger for a server
function getServerLogger(server: McpServer, extra?: Record<string, any>) {
  const base = {
    serverName: server?.name,
    serverId: server?.id,
    baseUrl: server?.baseUrl,
    type: server?.type || (server?.command ? 'stdio' : server?.baseUrl ? 'http' : 'inmemory')
  }
  return loggerService.withContext('McpRuntimeService', { ...base, ...extra })
}

/**
 * Higher-order function to add caching capability to any async function
 * @param fn The original function to be wrapped with caching
 * @param getCacheKey Function to generate a cache key from the function arguments
 * @param ttl Time to live for the cache entry in milliseconds
 * @param logPrefix Prefix for log messages
 * @returns The wrapped function with caching capability
 */
function withCache<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  getCacheKey: (...args: T) => string,
  ttl: number,
  logPrefix: string
): CachedFunction<T, R> {
  return async (...args: T): Promise<R> => {
    const cacheKey = getCacheKey(...args)
    const cacheService = application.get('CacheService')

    if (cacheService.has(cacheKey)) {
      logger.debug(`${logPrefix} loaded from cache`, { cacheKey: redactCacheKey(cacheKey) })
      const cachedData = cacheService.get<R>(cacheKey)
      if (cachedData) {
        return cachedData
      }
    }

    const start = Date.now()
    const result = await fn(...args)
    cacheService.set(cacheKey, result, ttl)
    logger.debug(`${logPrefix} cached`, {
      cacheKey: redactCacheKey(cacheKey),
      ttlMs: ttl,
      durationMs: Date.now() - start
    })
    return result
  }
}

@Injectable('McpRuntimeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager', 'McpPackageService'])
export class McpRuntimeService extends BaseService {
  private clients: Map<string, Client> = new Map()
  private pendingClients: Map<string, Promise<Client>> = new Map()
  // Keyed by toolCallKey(callId, scope). Caller-supplied call ids are NOT process-wide
  // unique (AI SDK providers may reuse ids like "call_0" across topics), so scoped callers
  // are namespaced, and every concurrent call registers its own controller under its key
  // instead of overwriting the previous one.
  private activeToolCalls: Map<string, Set<AbortController>> = new Map()
  private serverLogs = new ServerLogBuffer(200)
  private stopping = false
  private readonly _onToolListChanged = new Emitter<McpToolListChangedEvent>()
  readonly onToolListChanged: Event<McpToolListChangedEvent> = this._onToolListChanged.event

  private get mcpPackageService(): McpPackageService {
    return application.get('McpPackageService')
  }

  protected async onInit(): Promise<void> {
    this.stopping = false
  }

  protected async onStop(): Promise<void> {
    this.stopping = true
    this.abortActiveToolCalls()
    await this.waitForPendingClients()
    await this.closeAllClients()
    this.pendingClients.clear()
    this.clients.clear()
    this.serverLogs.clear()
  }

  private getServerById(serverId: string): McpServer {
    return mcpServerService.getById(serverId)
  }

  public setServerStatus(serverId: string, state: McpRuntimeState, error?: unknown): void {
    const lastError =
      state === 'error' ? (error instanceof Error ? error.message : String(error ?? 'Unknown error')) : undefined

    const cacheService = application.get('CacheService')
    const key = mcpStatusCacheKey(serverId)

    // setShared dedups via isEqual, but lastCheckedAt changes every call, so without this
    // guard every status touch (ping/list/prewarm hot paths) would broadcast IPC to all
    // windows. lastCheckedAt has no UI consumer, so leaving it stale on no-op writes is safe.
    const current = cacheService.getShared(key) as McpRuntimeStatus | undefined
    if (current && current.state === state && current.lastError === lastError) {
      return
    }

    const status: McpRuntimeStatus = {
      state,
      lastCheckedAt: Date.now(),
      ...(lastError !== undefined ? { lastError } : {})
    }
    cacheService.setShared(key, status)
  }

  /**
   * Call a tool by its full ID (serverId__toolName format).
   * Used by Hub server's runtime.
   */
  public async callToolById(toolId: string, params: unknown, callId?: string): Promise<McpCallToolResponse> {
    const parts = toolId.split('__')
    if (parts.length < 2) {
      throw new Error(`Invalid tool ID format: ${toolId}`)
    }

    const serverId = parts[0]
    const toolName = parts.slice(1).join('__')

    const server = mcpServerService.getById(serverId)

    logger.debug(`[callToolById] Calling tool ${toolName} on server ${server.name}`)

    return this.callToolByServer({
      server,
      name: toolName,
      args: params,
      callId
    })
  }

  public getServerKey(server: McpServer): string {
    return JSON.stringify({
      baseUrl: server.baseUrl,
      command: server.command,
      args: Array.isArray(server.args) ? server.args : [],
      registryUrl: server.registryUrl,
      env: server.env,
      headers: server.headers,
      id: server.id
    })
  }

  private isServerKeyForId(serverKey: string, serverId: string): boolean {
    try {
      return (JSON.parse(serverKey) as { id?: unknown }).id === serverId
    } catch {
      return false
    }
  }

  private emitServerLog(server: McpServer, entry: McpServerLogEntry) {
    const serverKey = this.getServerKey(server)
    this.serverLogs.append(serverKey, entry)
    application
      .get('IpcApiService')
      .broadcastToType(WindowType.Main, 'mcp.server.log', { ...entry, serverId: server.id })
  }

  public async getServerLogs(serverId: string): Promise<McpServerLogEntry[]> {
    const server = this.getServerById(serverId)
    return this.serverLogs.get(this.getServerKey(server))
  }

  public async withClient<T>(
    serverId: string,
    operation: (client: Client, server: McpServer) => Promise<T>
  ): Promise<T> {
    const server = this.getServerById(serverId)
    const client = await this.getOrCreateClient(server)
    return operation(client, server)
  }

  private async getOrCreateClient(server: McpServer): Promise<Client> {
    if (this.stopping || this.isStopped || this.isDestroyed) {
      throw new Error('MCP runtime is stopping')
    }

    if (!server.isActive) {
      this.setServerStatus(server.id, 'disabled')
      throw new Error(`MCP server ${server.name} is disabled`)
    }

    const serverKey = this.getServerKey(server)
    const reusable = await this.reuseLiveClient(server, serverKey)
    if (reusable) {
      return reusable
    }

    this.setServerStatus(server.id, 'connecting')

    const initPromise = this.connectClient(server, serverKey).finally(() => {
      this.pendingClients.delete(serverKey)
    })
    this.pendingClients.set(serverKey, initPromise)

    return initPromise
  }

  /** A client that is still usable: an in-flight connect, or a cached one that answers a ping. */
  private async reuseLiveClient(server: McpServer, serverKey: string): Promise<Client | undefined> {
    const pendingClient = this.pendingClients.get(serverKey)
    if (pendingClient) {
      this.setServerStatus(server.id, 'connecting')
      getServerLogger(server).silly(`Waiting for pending client initialization`)
      return pendingClient
    }

    const existingClient = this.clients.get(serverKey)
    if (!existingClient) {
      return undefined
    }

    try {
      // add short timeout to prevent hanging
      const pingResult = await existingClient.ping({ timeout: PING_TIMEOUT_MS })
      getServerLogger(server).debug(`Ping result`, { ok: !!pingResult })
      if (pingResult) {
        this.setServerStatus(server.id, 'connected')
        return existingClient
      }
    } catch (error) {
      getServerLogger(server).error(`Error pinging server ${server.name}`, error as Error)
    }

    await this.discardStaleClient(serverKey)
    return undefined
  }

  private async connectClient(server: McpServer, serverKey: string): Promise<Client> {
    const sdk = await loadMcpClientSdk()
    // Create new client instance for each connection
    const client = new sdk.Client({ name: 'Cherry Studio', version: app.getVersion() }, { capabilities: {} })

    const authProvider = new McpOAuthClientProvider({
      serverUrlHash: crypto
        .createHash('md5')
        .update(server.baseUrl || '')
        .digest('hex')
    })

    const args = [...(server.args || [])]
    const createServerTransport = (typeOverride?: McpServerType) =>
      createTransport({
        sdk,
        server,
        args,
        typeOverride,
        authProvider,
        logger: getServerLogger(server),
        onServerLog: (entry) => this.emitServerLog(server, entry)
      })

    try {
      await this.connectWithFallback({ client, server, sdk, authProvider, createServerTransport })

      this.emitServerLog(server, {
        timestamp: Date.now(),
        level: 'info',
        message: 'Server connected',
        source: 'client'
      })

      if (this.stopping || this.isStopped || this.isDestroyed) {
        await client.close()
        throw new Error('MCP runtime is stopping')
      }

      // Store the new client in the cache
      this.clients.set(serverKey, client)
      this.setServerStatus(server.id, 'connected')

      // Set up notification handlers
      this.setupNotificationHandlers(client, server, sdk)

      // Clear existing cache to ensure fresh data
      this.clearServerCache(server)

      logger.debug(`Activated server: ${server.name}`)
      this.emitServerLog(server, {
        timestamp: Date.now(),
        level: 'info',
        message: 'Server activated',
        source: 'client'
      })
      return client
    } catch (error) {
      this.setServerStatus(server.id, 'error', error)
      getServerLogger(server).error(`Error activating server ${server.name}`, error as Error)
      this.emitServerLog(server, {
        timestamp: Date.now(),
        level: 'error',
        message: `Error activating server: ${(error as Error)?.message}`,
        data: redactSensitive(error),
        source: 'client'
      })
      throw error
    }
  }

  /**
   * Connects with the configured transport, retrying the alternative one when the failure is a
   * transport/protocol mismatch (e.g. an SSE GET rejected with 405), and running the OAuth flow
   * when the server demands authentication.
   */
  private async connectWithFallback({
    client,
    server,
    sdk,
    authProvider,
    createServerTransport
  }: {
    client: Client
    server: McpServer
    sdk: McpClientSdk
    authProvider: McpOAuthClientProvider
    createServerTransport: (typeOverride?: McpServerType) => Promise<McpTransport>
  }): Promise<void> {
    // Bound the MCP `initialize` request so a non-responsive server fails fast via the
    // SDK's own abort path instead of hanging. Use a 180s floor (activation runs once,
    // generous headroom is cheap) while still honoring larger `server.timeout` values
    // that the user explicitly configured. transport.start() latency remains bounded
    // by the underlying fetch / child_process, matching v1.8.4 behavior.
    const connectOptions: RequestOptions = {
      timeout: Math.max((server.timeout ?? 0) * 1000, MCP_CONNECT_TIMEOUT_FLOOR_MS)
    }

    // When no fallback candidates exist (stdio / in-memory), connect with the configured
    // transport exactly once.
    const candidates = getTransportCandidates(server)
    const transportTypes: (McpServerType | undefined)[] = candidates ?? [undefined]
    let lastError: unknown

    for (let i = 0; i < transportTypes.length; i++) {
      const candidateType = transportTypes[i]
      const transport = await createServerTransport(candidateType)
      try {
        await client.connect(transport, connectOptions)
        return
      } catch (error: any) {
        if (error instanceof Error && (error.name === 'UnauthorizedError' || error.message.includes('Unauthorized'))) {
          logger.debug(`Authentication required for server: ${server.name}`)
          await this.finishOAuth({
            client,
            server,
            transport: transport as SSEClientTransport | StreamableHTTPClientTransport,
            authProvider,
            createServerTransport,
            typeOverride: candidateType
          })
          return
        }
        lastError = error
        // Only fall back on a transport-level protocol error (e.g. SSE GET 405 → retry
        // with Streamable HTTP). Do not fall back on timeouts, auth, or other failures.
        if (i === transportTypes.length - 1 || !candidates || !isTransportFallbackError(error, sdk)) {
          break
        }
        getServerLogger(server).warn(`Transport '${candidateType}' failed, falling back to '${candidates[i + 1]}'`, {
          error: redactSensitive(error)
        })
        // Close the whole client (not just the transport) so the SDK resets its internal
        // _transport before we retry. Reusing the client for the fallback mirrors the OAuth
        // re-auth path, which relies on client.close() clearing _transport first.
        await client.close().catch(() => undefined)
      }
    }

    // Release the last (failed) transport/connection so it isn't leaked until GC.
    await client.close().catch(() => undefined)
    throw lastError ?? new Error('Failed to connect to MCP server')
  }

  private async finishOAuth({
    client,
    server,
    transport,
    authProvider,
    createServerTransport,
    typeOverride
  }: {
    client: Client
    server: McpServer
    transport: SSEClientTransport | StreamableHTTPClientTransport
    authProvider: McpOAuthClientProvider
    createServerTransport: (typeOverride?: McpServerType) => Promise<McpTransport>
    typeOverride?: McpServerType
  }): Promise<void> {
    getServerLogger(server).debug(`Starting OAuth flow`)
    const events = new EventEmitter()
    const callbackServer = new CallBackServer({
      port: authProvider.config.callbackPort,
      path: authProvider.config.callbackPath || '/oauth/callback',
      events
    })

    const timeoutId = setTimeout(() => {
      getServerLogger(server).warn(`OAuth flow timed out`)
      void callbackServer.close()
    }, 300000) // 5 minutes timeout

    try {
      const authCode = await callbackServer.waitForAuthCode()
      getServerLogger(server).debug(`Received auth code`)

      await transport.finishAuth(authCode)
      getServerLogger(server).debug(`OAuth flow completed`)

      // Try to connect again
      await client.connect(await createServerTransport(typeOverride))
      getServerLogger(server).debug(`Successfully authenticated`)
    } catch (oauthError) {
      getServerLogger(server).error(`OAuth authentication failed`, oauthError as Error)
      throw new Error(
        `OAuth authentication failed: ${oauthError instanceof Error ? oauthError.message : String(oauthError)}`
      )
    } finally {
      clearTimeout(timeoutId)
      void callbackServer.close()
    }
  }

  /**
   * Set up notification handlers for MCP client
   */
  private setupNotificationHandlers(client: Client, server: McpServer, sdk: McpClientSdk) {
    const serverKey = this.getServerKey(server)
    const cacheService = application.get('CacheService')

    try {
      // Set up tools list changed notification handler
      client.setNotificationHandler(sdk.ToolListChangedNotificationSchema, async () => {
        logger.debug(`Tools list changed for server: ${server.name}`)
        this._onToolListChanged.fire({ serverId: server.id })
      })

      // Set up resources list changed notification handler
      client.setNotificationHandler(sdk.ResourceListChangedNotificationSchema, async () => {
        logger.debug(`Resources list changed for server: ${server.name}`)
        // Clear resources cache
        cacheService.delete(`mcp:list_resources:${serverKey}`)
      })

      // Set up prompts list changed notification handler
      client.setNotificationHandler(sdk.PromptListChangedNotificationSchema, async () => {
        logger.debug(`Prompts list changed for server: ${server.name}`)
        // Clear prompts cache
        cacheService.delete(`mcp:list_prompts:${serverKey}`)
      })

      // Set up resource updated notification handler
      client.setNotificationHandler(sdk.ResourceUpdatedNotificationSchema, async () => {
        logger.debug(`Resource updated for server: ${server.name}`)
        // Clear resource-specific caches
        this.clearResourceCaches(serverKey)
      })

      // Set up cancelled notification handler
      client.setNotificationHandler(sdk.CancelledNotificationSchema, async (notification) => {
        logger.debug(`Operation cancelled for server: ${server.name}`, redactSensitive(notification.params))
      })

      // Set up logging message notification handler
      client.setNotificationHandler(sdk.LoggingMessageNotificationSchema, async (notification) => {
        const data = notification.params?.data
        const redactedData = redactSensitive(data)
        const message = safeSerialize(redactedData) ?? 'No data'
        logger.debug(`Message from server ${server.name}: ${message}`)
        if (data) {
          this.emitServerLog(server, {
            timestamp: Date.now(),
            // FIXME: as McpServerLogEntry['level'] not type safe
            level: (notification.params?.level as McpServerLogEntry['level']) || 'info',
            message,
            data: redactedData,
            source: notification.params?.logger || 'server'
          })
        }
      })

      getServerLogger(server).debug(`Set up notification handlers`)
    } catch (error) {
      getServerLogger(server).error(`Failed to set up notification handlers`, error as Error)
    }
  }

  /**
   * Clear resource-specific caches for a server
   */
  private clearResourceCaches(serverKey: string) {
    application.get('CacheService').delete(`mcp:list_resources:${serverKey}`)
  }

  /**
   * Clear all caches for a specific server
   */
  private clearServerCache(serverOrKey: McpServer | string) {
    const serverKey = typeof serverOrKey === 'string' ? serverOrKey : this.getServerKey(serverOrKey)
    const cacheService = application.get('CacheService')
    cacheService.delete(`mcp:list_tool:${serverKey}`)
    cacheService.delete(`mcp:list_prompts:${serverKey}`)
    cacheService.delete(`mcp:list_resources:${serverKey}`)
    logger.debug(`Cleared all caches for server`, { serverKey: redactServerKey(serverKey) })
  }

  private getLatestSourcePolicy(server: McpServer): McpServer {
    try {
      return mcpServerService.getById(server.id)
    } catch {
      return server
    }
  }

  private abortActiveToolCalls() {
    for (const [key, controllers] of this.activeToolCalls) {
      for (const controller of controllers) {
        controller.abort()
      }
      logger.debug(`Aborted active tool call during MCP runtime stop`, { key })
    }
    this.activeToolCalls.clear()
  }

  private async waitForPendingClients(): Promise<void> {
    const pending = [...this.pendingClients.values()]
    if (pending.length === 0) return
    await Promise.allSettled(pending)
  }

  private async closeAllClients(): Promise<void> {
    const serverKeys = [...this.clients.keys()]
    const results = await Promise.allSettled(serverKeys.map((key) => this.closeClient(key)))
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error(`Failed to close client`, result.reason as Error)
      }
    }
  }

  /**
   * A client that failed its liveness ping must still be closed — dropping it from the map
   * alone orphans the stdio child process (issue #18144).
   */
  private async discardStaleClient(serverKey: string): Promise<void> {
    try {
      await this.closeClient(serverKey)
    } catch (error) {
      logger.error(`Failed to close stale client`, error as Error)
      this.clients.delete(serverKey)
    }
  }

  async closeClient(serverKey: string) {
    const client = this.clients.get(serverKey)
    if (client) {
      // Remove the client from the cache
      await client.close()
      logger.debug(`Closed server`, { serverKey: redactServerKey(serverKey) })
      this.clients.delete(serverKey)
      // Clear all caches for this server
      this.clearServerCache(serverKey)
      this.serverLogs.remove(serverKey)
    } else {
      logger.warn(`No client found for server`, { serverKey: redactServerKey(serverKey) })
    }
  }

  private async closeClientsForServer(serverId: string): Promise<void> {
    // Settle any in-flight connects first. A pending client is not in `this.clients`
    // yet, so closing only `this.clients` would leak it — worst case `removeServer`
    // deletes the DB row while a connect is still in flight. Awaiting the pending
    // promise lets a successful connect land in `this.clients` (so the loop below
    // closes it); a failed connect just settles and is dropped.
    const pendingKeys = Array.from(this.pendingClients.keys()).filter((key) => this.isServerKeyForId(key, serverId))
    await Promise.all(pendingKeys.map((key) => this.pendingClients.get(key)?.catch(() => undefined)))

    const serverKeys = Array.from(this.clients.keys()).filter((key) => this.isServerKeyForId(key, serverId))
    await Promise.all(serverKeys.map((key) => this.closeClient(key)))
  }

  async stopServer(serverId: string) {
    const server = this.getServerById(serverId)
    getServerLogger(server).debug(`Stopping server`)
    this.emitServerLog(server, {
      timestamp: Date.now(),
      level: 'info',
      message: 'Stopping server',
      source: 'client'
    })
    try {
      await this.closeClientsForServer(server.id)
    } finally {
      application.get('McpCatalogService').clearSharedToolsCache(server.id)
      this.setServerStatus(server.id, 'disabled')
    }
  }

  async removeServer(serverId: string) {
    const server = this.getServerById(serverId)
    try {
      await this.closeClientsForServer(server.id)
    } finally {
      application.get('McpCatalogService').clearSharedToolsCache(server.id)
      this.setServerStatus(server.id, 'disabled')
    }

    // Cleanup OAuth token file for this server, but only if no other server
    // entry still points at the same baseUrl (shared OAuth storage key is
    // md5(baseUrl), so unlinking prematurely would break the remaining entry).
    if (server.baseUrl) {
      try {
        const { items: remainingServers } = mcpServerService.list({})
        const baseUrlStillInUse = remainingServers.some((s) => s.id !== server.id && s.baseUrl === server.baseUrl)
        if (!baseUrlStillInUse) {
          const serverUrlHash = crypto.createHash('md5').update(server.baseUrl).digest('hex')
          const oauthFilePath = application.getPath('feature.mcp.oauth', `${serverUrlHash}_oauth.json`)
          await fs.unlink(oauthFilePath)
          getServerLogger(server).debug(`Cleaned up OAuth token file`)
        } else {
          getServerLogger(server).debug(`Skipped OAuth token cleanup; baseUrl still in use by another server`)
        }
      } catch (error) {
        // Ignore ENOENT - file may not exist if server never used OAuth
        if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
          getServerLogger(server).error(`Failed to cleanup OAuth token file`, error as Error)
        }
      }
    }

    // If this is a package server, cleanup its directory
    if (server.dxtPath) {
      try {
        const cleaned = this.mcpPackageService.cleanupPackageServer(server.name)
        if (cleaned) {
          getServerLogger(server).debug(`Cleaned up package server directory`)
        }
      } catch (error) {
        getServerLogger(server).error(`Failed to cleanup package server`, error as Error)
      }
    }
  }

  async restartServer(serverId: string) {
    const server = this.getServerById(serverId)
    getServerLogger(server).debug(`Restarting server`)
    this.emitServerLog(server, {
      timestamp: Date.now(),
      level: 'info',
      message: 'Restarting server',
      source: 'client'
    })
    await this.closeClientsForServer(server.id)
    // Clear caches before restarting to ensure fresh data. Drop the shared
    // `mcp.tools.<serverId>` cache too: `McpCatalogService.listTools` is cache-only, so a
    // restart that fails (e.g. a bad new config) must not leave the old config's tools
    // visible to agents/chat. `refreshTools` repopulates it on success. (issue #16242)
    this.clearServerCache(server)
    application.get('McpCatalogService').clearSharedToolsCache(server.id)
    try {
      await this.getOrCreateClient(server)
      await application.get('McpCatalogService').refreshTools(server.id)
    } catch (error) {
      this.setServerStatus(server.id, 'error', error)
      throw error
    }
  }

  /**
   * Check connectivity for an MCP server
   */
  public async checkMcpConnectivity(serverId: string): Promise<boolean> {
    const server = this.getServerById(serverId)
    getServerLogger(server).debug(`Checking connectivity`)
    try {
      const client = await this.getOrCreateClient(server)
      // Attempt to list tools as a way to check connectivity
      await client.listTools()
      getServerLogger(server).debug(`Connectivity check successful`)
      this.setServerStatus(server.id, 'connected')
      this.emitServerLog(server, {
        timestamp: Date.now(),
        level: 'info',
        message: 'Connectivity check successful',
        source: 'connectivity'
      })
      return true
    } catch (error) {
      getServerLogger(server).error(`Connectivity check failed`, error as Error)
      this.emitServerLog(server, {
        timestamp: Date.now(),
        level: 'error',
        message: `Connectivity check failed: ${(error as Error).message}`,
        data: redactSensitive(error),
        source: 'connectivity'
      })
      // Close the client if connectivity check fails to ensure a clean state for the next attempt
      const serverKey = this.getServerKey(server)
      await this.closeClient(serverKey)
      application.get('McpCatalogService').clearSharedToolsCache(server.id)
      this.setServerStatus(server.id, 'error', error)
      return false
    }
  }

  /**
   * Call a tool on an MCP server
   */
  public async callTool({
    serverId,
    name,
    args,
    callId,
    scope,
    signal,
    onProgress
  }: CallToolArgs): Promise<McpCallToolResponse> {
    const server = this.getServerById(serverId)
    return this.callToolByServer({ server, name, args, callId, scope, signal, onProgress })
  }

  public async callToolByServer({
    server,
    name,
    args,
    callId,
    scope,
    signal,
    onProgress
  }: RuntimeCallToolArgs): Promise<McpCallToolResponse> {
    const toolCallId = callId || uuidv4()
    const registrationKey = toolCallKey(toolCallId, scope)
    const abortController = new AbortController()
    const effectiveSignal = signal ? AbortSignal.any([abortController.signal, signal]) : abortController.signal
    const controllersForKey = this.activeToolCalls.get(registrationKey) ?? new Set()
    controllersForKey.add(abortController)
    this.activeToolCalls.set(registrationKey, controllersForKey)

    const callToolFunc = async ({ server, name, args }: RuntimeCallToolArgs) => {
      try {
        // Inside the try so an already-aborted signal still hits the finally cleanup below.
        if (effectiveSignal.aborted) {
          throw getAbortReason(effectiveSignal)
        }
        getServerLogger(server, { tool: name, callId: toolCallId }).debug(`Calling tool`, {
          args: redactSensitive(args)
        })
        if (typeof args === 'string') {
          if (args.trim() === '') {
            args = {}
          } else {
            try {
              args = JSON.parse(args)
            } catch (e) {
              // Fail fast instead of forwarding malformed JSON as a raw string — the MCP
              // server expects an object/record, so a bare string yields opaque downstream errors.
              throw new Error(`Invalid JSON tool arguments for ${name}: ${(e as Error).message}`)
            }
          }
        }
        const sourcePolicy = this.getLatestSourcePolicy(server)
        if (isMcpToolDisabledBySource(sourcePolicy, { name })) {
          throw new Error(`MCP tool is disabled: ${name}`)
        }
        // Client init (ping probe, transport connect, OAuth) has no unified timeout at this
        // layer — release this call's wait on abort instead of blocking until it settles.
        // The shared `pendingClients` init keeps running (only this caller's wait is released),
        // and both racers are consumed, so the loser's late rejection is never unhandled.
        // The listener is removed once the race settles: `once` only cleans up after an
        // abort fires, and the composed signal is retained by the long-lived stream signal —
        // leaving it installed would accumulate a closure per tool call.
        let handleAbort: (() => void) | undefined
        const client = await Promise.race([
          this.getOrCreateClient(server),
          new Promise<never>((_, reject) => {
            handleAbort = (): void => reject(getAbortReason(effectiveSignal))
            if (effectiveSignal.aborted) return handleAbort()
            effectiveSignal.addEventListener('abort', handleAbort, { once: true })
          })
        ]).finally(() => {
          if (handleAbort) effectiveSignal.removeEventListener('abort', handleAbort)
        })
        const result = await client.callTool({ name, arguments: args }, undefined, {
          onprogress: (process) => {
            getServerLogger(server, { tool: name, callId: toolCallId }).debug(`Progress`, {
              ratio: process.progress / (process.total || 1)
            })
            application.get('IpcApiService').broadcastToType(WindowType.Main, 'mcp.tool.call_progress', {
              callId: toolCallId,
              progress: process.progress / (process.total || 1)
            })
            // Additional consumer outside the renderer; must not break the call or the
            // broadcast above if it throws.
            try {
              onProgress?.(process)
            } catch (error) {
              getServerLogger(server, { tool: name, callId: toolCallId }).warn('Progress listener threw', {
                error
              })
            }
          },
          timeout: server.timeout ? server.timeout * 1000 : 60000, // Default timeout of 1 minute,
          // 需要服务端支持: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#timeouts
          // Need server side support: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#timeouts
          resetTimeoutOnProgress: server.longRunning,
          maxTotalTimeout: server.longRunning ? 10 * 60 * 1000 : undefined,
          signal: effectiveSignal
        })
        return result as McpCallToolResponse
      } catch (error) {
        if (isMcpCancellation(error, effectiveSignal)) {
          // Expected cancellation (user stop / stream abort) — keep it out of error logs.
          // A genuine failure that merely raced the abort does not match and stays error-level.
          getServerLogger(server, { tool: name, callId: toolCallId }).debug(`Tool call aborted`)
        } else {
          getServerLogger(server, { tool: name, callId: toolCallId }).error(`Error calling tool`, error as Error)
        }
        throw error
      } finally {
        // Remove only this call's controller — a concurrent call sharing the key must stay abortable.
        const controllers = this.activeToolCalls.get(registrationKey)
        if (controllers) {
          controllers.delete(abortController)
          if (controllers.size === 0) {
            this.activeToolCalls.delete(registrationKey)
          }
        }
      }
    }

    const tracedInput = {
      server: { id: server.id, name: server.name, type: server.type, description: server.description },
      name,
      args
    }
    return await withSpanFunc(
      `${server.name}.${name}`,
      `MCP`,
      // oxlint-disable-next-line no-unused-vars
      (_recorded: typeof tracedInput) => callToolFunc({ server, name, args }),
      [tracedInput]
    )
  }

  /**
   * List prompts available on an MCP server
   */
  private async listPromptsImpl(server: McpServer): Promise<McpPrompt[]> {
    const client = await this.getOrCreateClient(server)
    getServerLogger(server).debug(`Listing prompts`)
    try {
      const { prompts } = await client.listPrompts()
      return prompts.map((prompt: any) => ({
        ...prompt,
        id: `p${nanoid()}`,
        serverId: server.id,
        serverName: server.name
      }))
    } catch (error: unknown) {
      // -32601 (method not found) means the server has no prompts capability — a stable
      // empty result that is safe to cache. Any other error is transient; rethrow it so
      // `withCache` does NOT cache an empty list for the full TTL (the public `listPrompts`
      // catches it and returns `[]` to callers without poisoning the cache).
      if ((error as { code?: number })?.code === -32601) {
        return []
      }
      throw error
    }
  }

  /**
   * List prompts available on an MCP server with caching
   */
  public async listPrompts(serverId: string): Promise<McpPrompt[]> {
    const server = this.getServerById(serverId)
    const cachedListPrompts = withCache<[McpServer], McpPrompt[]>(
      this.listPromptsImpl.bind(this),
      (server) => {
        const serverKey = this.getServerKey(server)
        return `mcp:list_prompts:${serverKey}`
      },
      60 * 60 * 1000, // 60 minutes TTL
      `[MCP] Prompts from ${server.name}`
    )
    try {
      return await cachedListPrompts(server)
    } catch (error) {
      getServerLogger(server).error(`Failed to list prompts`, error as Error)
      return []
    }
  }

  /**
   * Get a specific prompt from an MCP server (implementation)
   */
  private async getPromptImpl(server: McpServer, name: string, args?: Record<string, any>): Promise<GetPromptResult> {
    logger.debug(`Getting prompt ${name} from server: ${server.name}`)
    const client = await this.getOrCreateClient(server)
    return await client.getPrompt({ name, arguments: args })
  }

  /**
   * Get a specific prompt from an MCP server with caching
   */
  @TraceMethod({ spanName: 'getPrompt', tag: 'mcp' })
  public async getPrompt({
    serverId,
    name,
    args
  }: {
    serverId: string
    name: string
    args?: Record<string, any>
  }): Promise<GetPromptResult> {
    const server = this.getServerById(serverId)
    const cachedGetPrompt = withCache<[McpServer, string, Record<string, any> | undefined], GetPromptResult>(
      this.getPromptImpl.bind(this),
      (server, name, args) => {
        const serverKey = this.getServerKey(server)
        const argsKey = args ? JSON.stringify(args) : 'no-args'
        return `mcp:get_prompt:${serverKey}:${name}:${argsKey}`
      },
      30 * 60 * 1000, // 30 minutes TTL
      `[MCP] Prompt ${name} from ${server.name}`
    )
    return await cachedGetPrompt(server, name, args)
  }

  /**
   * List resources available on an MCP server (implementation)
   */
  private async listResourcesImpl(server: McpServer): Promise<McpResource[]> {
    const client = await this.getOrCreateClient(server)
    logger.debug(`Listing resources for server: ${server.name}`)
    try {
      const result = await client.listResources()
      const resources = result.resources || []
      return (Array.isArray(resources) ? resources : []).map((resource: any) => ({
        ...resource,
        serverId: server.id,
        serverName: server.name
      }))
    } catch (error: any) {
      // -32601 (method not found) is a stable empty result safe to cache; rethrow anything
      // else so a transient failure isn't cached as an empty list for the full TTL.
      if (error?.code === -32601) {
        return []
      }
      throw error
    }
  }

  /**
   * List resources available on an MCP server with caching
   */
  public async listResources(serverId: string): Promise<McpResource[]> {
    const server = this.getServerById(serverId)
    const cachedListResources = withCache<[McpServer], McpResource[]>(
      this.listResourcesImpl.bind(this),
      (server) => {
        const serverKey = this.getServerKey(server)
        return `mcp:list_resources:${serverKey}`
      },
      60 * 60 * 1000, // 60 minutes TTL
      `[MCP] Resources from ${server.name}`
    )
    try {
      return await cachedListResources(server)
    } catch (error) {
      getServerLogger(server).error(`Failed to list resources`, error as Error)
      return []
    }
  }

  /**
   * Get a specific resource from an MCP server (implementation)
   */
  private async getResourceImpl(server: McpServer, uri: string): Promise<GetResourceResponse> {
    getServerLogger(server, { uri }).debug(`Getting resource`)
    const client = await this.getOrCreateClient(server)
    try {
      const result = await client.readResource({ uri: uri })
      const contents: McpResource[] = []
      if (result.contents && result.contents.length > 0) {
        result.contents.forEach((content: any) => {
          contents.push({
            ...content,
            serverId: server.id,
            serverName: server.name
          })
        })
      }
      return {
        contents: contents
      }
    } catch (error: any) {
      getServerLogger(server, { uri }).error(`Failed to get resource`, error as Error)
      throw new Error(`Failed to get resource ${uri} from server: ${server.name}: ${error.message}`)
    }
  }

  /**
   * Get a specific resource from an MCP server with caching
   */
  @TraceMethod({ spanName: 'getResource', tag: 'mcp' })
  public async getResource({ serverId, uri }: { serverId: string; uri: string }): Promise<GetResourceResponse> {
    const server = this.getServerById(serverId)
    const cachedGetResource = withCache<[McpServer, string], GetResourceResponse>(
      this.getResourceImpl.bind(this),
      (server, uri) => {
        const serverKey = this.getServerKey(server)
        return `mcp:get_resource:${serverKey}:${uri}`
      },
      30 * 60 * 1000, // 30 minutes TTL
      `[MCP] Resource ${uri} from ${server.name}`
    )
    return await cachedGetResource(server, uri)
  }

  // 实现 abortTool 方法
  public async abortTool(callId: string, scope?: string) {
    // Exact (scope, callId) match only — a colliding id registered under another scope
    // (another topic's `call_0`) must never be collateral of this caller's cancel.
    const key = toolCallKey(callId, scope)
    const controllers = this.activeToolCalls.get(key)
    if (controllers) {
      // Within one scope a duplicated id is still ambiguous — abort every call under it:
      // cancelling a same-scope sibling is recoverable; leaving one un-cancellable is not.
      for (const controller of controllers) {
        controller.abort()
      }
      this.activeToolCalls.delete(key)
      logger.debug(`Aborted tool call`, { callId, scope })
      return true
    } else {
      logger.warn(`No active tool call found for callId`, { callId, scope })
      return false
    }
  }

  /**
   * Get the server version information
   */
  public async getServerVersion(serverId: string): Promise<string | null> {
    const server = this.getServerById(serverId)
    try {
      getServerLogger(server).debug(`Getting server version`)
      const client = await this.getOrCreateClient(server)

      // Try to get server information which may include version
      const serverInfo = client.getServerVersion()
      getServerLogger(server).debug(`Server info`, redactSensitive(serverInfo))

      if (serverInfo && serverInfo.version) {
        getServerLogger(server).debug(`Server version`, { version: serverInfo.version })
        return serverInfo.version
      }

      getServerLogger(server).warn(`No version information available`)
      return null
    } catch (error: any) {
      getServerLogger(server).error(`Failed to get server version`, error as Error)
      return null
    }
  }
}
