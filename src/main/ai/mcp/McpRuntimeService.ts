import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { createInMemoryMcpServer } from '@main/ai/mcp/servers/factory'
import { BaseService, DependsOn, Emitter, type Event, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { makeSureDirExists, removeEnvProxy } from '@main/utils'
import { findCommandInShellEnv, getBinaryName, getBinaryPath, isBinaryExists } from '@main/utils/process'
import getLoginShellEnvironment from '@main/utils/shell-env'
import { TraceMethod, withSpanFunc } from '@mcp-trace/trace-core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions
} from '@modelcontextprotocol/sdk/client/streamableHttp'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory'
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
// Import notification schemas from MCP SDK
import {
  CancelledNotificationSchema,
  type GetPromptResult,
  LoggingMessageNotificationSchema,
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ToolListChangedNotificationSchema
} from '@modelcontextprotocol/sdk/types.js'
import { nanoid } from '@reduxjs/toolkit'
import { isMcpToolDisabledBySource } from '@shared/ai/tools/mcpSourcePolicy'
import type { McpProgressEvent } from '@shared/config/types'
import type { McpServerLogEntry } from '@shared/config/types'
import type { SharedCacheKey } from '@shared/data/cache/cacheSchemas'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import { IpcChannel } from '@shared/IpcChannel'
import { defaultAppHeaders } from '@shared/utils'
import { safeSerialize } from '@shared/utils/serialize'
import {
  BuiltinMcpServerNames,
  type GetResourceResponse,
  isBuiltinMcpServer,
  type McpCallToolResponse,
  type McpPrompt,
  type McpResource,
  type McpServer
} from '@types'
import { app, net } from 'electron'
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
import * as z from 'zod'

import type { DxtService } from './DxtService'
import { CallBackServer } from './oauth/callback'
import { McpOAuthClientProvider } from './oauth/provider'
import { ServerLogBuffer } from './ServerLogBuffer'

// Generic type for caching wrapped functions
type CachedFunction<T extends unknown[], R> = (...args: T) => Promise<R>

type CallToolArgs = { serverId: string; name: string; args: any; callId?: string }
type RuntimeCallToolArgs = { server: McpServer; name: string; args: any; callId?: string }
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
export const McpGetPromptPayloadSchema = z.object({
  serverId: z.string().min(1),
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional()
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

// Redact potentially sensitive fields in objects (headers, tokens, api keys)
export function redactSensitive(input: any): any {
  const SENSITIVE_KEYS = ['authorization', 'Authorization', 'apiKey', 'api_key', 'apikey', 'token', 'access_token']
  const MAX_STRING = 300

  // Track visited objects so a circular graph (e.g. an Error with an assigned `cause`,
  // or HTTP request<->response cross-references) can't drive unbounded recursion → stack
  // overflow inside the logger. This runs on caught Errors and server-controlled payloads.
  const redact = (val: any, seen: WeakSet<object>): any => {
    if (val == null) return val
    if (typeof val === 'string') {
      return val.length > MAX_STRING ? `${val.slice(0, MAX_STRING)}…<${val.length - MAX_STRING} more>` : val
    }
    if (typeof val === 'object') {
      if (seen.has(val)) return '[Circular]'
      seen.add(val)
    }
    if (Array.isArray(val)) return val.map((v) => redact(v, seen))
    if (typeof val === 'object') {
      const out: Record<string, any> = {}
      for (const [k, v] of Object.entries(val)) {
        if (SENSITIVE_KEYS.includes(k)) {
          out[k] = '<redacted>'
        } else {
          out[k] = redact(v, seen)
        }
      }
      return out
    }
    return val
  }

  return redact(input, new WeakSet())
}

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
      logger.debug(`${logPrefix} loaded from cache`, { cacheKey })
      const cachedData = cacheService.get<R>(cacheKey)
      if (cachedData) {
        return cachedData
      }
    }

    const start = Date.now()
    const result = await fn(...args)
    cacheService.set(cacheKey, result, ttl)
    logger.debug(`${logPrefix} cached`, { cacheKey, ttlMs: ttl, durationMs: Date.now() - start })
    return result
  }
}

@Injectable('McpRuntimeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager', 'DxtService'])
export class McpRuntimeService extends BaseService {
  private clients: Map<string, Client> = new Map()
  private pendingClients: Map<string, Promise<Client>> = new Map()
  private activeToolCalls: Map<string, AbortController> = new Map()
  private serverLogs = new ServerLogBuffer(200)
  private stopping = false
  private readonly _onToolListChanged = new Emitter<McpToolListChangedEvent>()
  readonly onToolListChanged: Event<McpToolListChangedEvent> = this._onToolListChanged.event

  private get dxtService(): DxtService {
    return application.get('DxtService')
  }

  protected async onInit(): Promise<void> {
    this.stopping = false
    this.registerIpcHandlers()
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

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.Mcp_RemoveServer, (_e, serverId: string) => this.removeServer(serverId))
    this.ipcHandle(IpcChannel.Mcp_RestartServer, (_e, serverId: string) => this.restartServer(serverId))
    this.ipcHandle(IpcChannel.Mcp_StopServer, (_e, serverId: string) => this.stopServer(serverId))
    this.ipcHandle(IpcChannel.Mcp_RefreshTools, async (_e, serverId: string) => {
      await application.get('McpCatalogService').refreshTools(serverId)
    })
    this.ipcHandle(IpcChannel.Mcp_CallTool, (_e, args) =>
      this.callTool(McpCallToolPayloadSchema.parse(args) as CallToolArgs)
    )
    this.ipcHandle(IpcChannel.Mcp_ListPrompts, (_e, serverId) => this.listPrompts(NonEmptyStringSchema.parse(serverId)))
    this.ipcHandle(IpcChannel.Mcp_GetPrompt, (_e, args) => this.getPrompt(McpGetPromptPayloadSchema.parse(args)))
    this.ipcHandle(IpcChannel.Mcp_ListResources, (_e, serverId) =>
      this.listResources(NonEmptyStringSchema.parse(serverId))
    )
    this.ipcHandle(IpcChannel.Mcp_GetResource, (_e, args) => this.getResource(McpGetResourcePayloadSchema.parse(args)))
    this.ipcHandle(IpcChannel.Mcp_GetInstallInfo, () => this.getInstallInfo())
    this.ipcHandle(IpcChannel.Mcp_CheckConnectivity, (_e, serverId) =>
      this.checkMcpConnectivity(NonEmptyStringSchema.parse(serverId))
    )
    this.ipcHandle(IpcChannel.Mcp_AbortTool, (_e, callId) => this.abortTool(NonEmptyStringSchema.parse(callId)))
    this.ipcHandle(IpcChannel.Mcp_GetServerVersion, (_e, serverId) =>
      this.getServerVersion(NonEmptyStringSchema.parse(serverId))
    )
    this.ipcHandle(IpcChannel.Mcp_GetServerLogs, async (_e, serverId) =>
      this.getServerLogs(NonEmptyStringSchema.parse(serverId))
    )
  }

  private async getServerById(serverId: string): Promise<McpServer> {
    return await mcpServerService.getById(serverId)
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

    const server = await mcpServerService.getById(serverId)

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
      .get('WindowManager')
      .broadcastToType(WindowType.Main, IpcChannel.Mcp_ServerLog, { ...entry, serverId: server.id })
  }

  public async getServerLogs(serverId: string): Promise<McpServerLogEntry[]> {
    const server = await this.getServerById(serverId)
    return this.serverLogs.get(this.getServerKey(server))
  }

  public async withClient<T>(
    serverId: string,
    operation: (client: Client, server: McpServer) => Promise<T>
  ): Promise<T> {
    const server = await this.getServerById(serverId)
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

    // If there's a pending initialization, wait for it
    const pendingClient = this.pendingClients.get(serverKey)
    if (pendingClient) {
      this.setServerStatus(server.id, 'connecting')
      getServerLogger(server).silly(`Waiting for pending client initialization`)
      return pendingClient
    }

    // Check if we already have a client for this server configuration
    const existingClient = this.clients.get(serverKey)
    if (existingClient) {
      try {
        // Check if the existing client is still connected
        const pingResult = await existingClient.ping({
          // add short timeout to prevent hanging
          timeout: 1000
        })
        getServerLogger(server).debug(`Ping result`, { ok: !!pingResult })
        // If the ping fails, remove the client from the cache
        // and create a new one
        if (!pingResult) {
          this.clients.delete(serverKey)
        } else {
          this.setServerStatus(server.id, 'connected')
          return existingClient
        }
      } catch (error: any) {
        getServerLogger(server).error(`Error pinging server ${server.name}`, error as Error)
        this.clients.delete(serverKey)
      }
    }

    this.setServerStatus(server.id, 'connecting')

    const prepareHeaders = () => {
      return {
        ...defaultAppHeaders(),
        ...server.headers
      }
    }

    // Create a promise for the initialization process
    const initPromise = (async () => {
      try {
        // Create new client instance for each connection
        const client = new Client({ name: 'Cherry Studio', version: app.getVersion() }, { capabilities: {} })

        let args = [...(server.args || [])]

        // let transport: StdioClientTransport | SSEClientTransport | InMemoryTransport | StreamableHTTPClientTransport
        const authProvider = new McpOAuthClientProvider({
          serverUrlHash: crypto
            .createHash('md5')
            .update(server.baseUrl || '')
            .digest('hex')
        })

        const initTransport = async (): Promise<
          StdioClientTransport | SSEClientTransport | InMemoryTransport | StreamableHTTPClientTransport
        > => {
          // Create appropriate transport based on configuration

          // Special case for nowledgeMem and flomo - uses HTTP transport instead of in-memory
          if (
            isBuiltinMcpServer(server) &&
            (server.name === BuiltinMcpServerNames.nowledgeMem || server.name === BuiltinMcpServerNames.flomo)
          ) {
            const httpUrlMap: Record<string, string> = {
              [BuiltinMcpServerNames.nowledgeMem]: 'http://127.0.0.1:14242/mcp',
              [BuiltinMcpServerNames.flomo]: 'https://flomoapp.com/mcp'
            }
            const httpUrl = httpUrlMap[server.name]
            const options: StreamableHTTPClientTransportOptions = {
              fetch: async (url, init) => {
                return net.fetch(typeof url === 'string' ? url : url.toString(), init)
              },
              requestInit: {
                headers: {
                  ...defaultAppHeaders(),
                  APP: 'Cherry Studio'
                }
              },
              authProvider
            }
            getServerLogger(server).debug(`Using StreamableHTTPClientTransport for ${server.name}`)
            return new StreamableHTTPClientTransport(new URL(httpUrl), options)
          }

          if (isBuiltinMcpServer(server) && server.name !== BuiltinMcpServerNames.mcpAutoInstall) {
            getServerLogger(server).debug(`Using in-memory transport`)
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
            // start the in-memory server with the given name and environment variables
            const inMemoryServer = createInMemoryMcpServer(server.name, args, server.env || {})
            try {
              await inMemoryServer.connect(serverTransport)
              getServerLogger(server).debug(`In-memory server started`)
            } catch (error: any) {
              getServerLogger(server).error(`Error starting in-memory server`, error as Error)
              throw new Error(`Failed to start in-memory server: ${error.message}`)
            }
            // set the client transport to the client
            return clientTransport
          } else if (server.baseUrl) {
            if (server.type === 'streamableHttp') {
              const options: StreamableHTTPClientTransportOptions = {
                fetch: async (url, init) => {
                  return net.fetch(typeof url === 'string' ? url : url.toString(), init)
                },
                requestInit: {
                  headers: prepareHeaders()
                },
                authProvider
              }
              // redact headers before logging
              getServerLogger(server).debug(`StreamableHTTPClientTransport options`, {
                options: redactSensitive(options)
              })
              return new StreamableHTTPClientTransport(new URL(server.baseUrl), options)
            } else if (server.type === 'sse') {
              const options: SSEClientTransportOptions = {
                eventSourceInit: {
                  fetch: async (url, init) => {
                    return net.fetch(typeof url === 'string' ? url : url.toString(), init)
                  }
                },
                requestInit: {
                  headers: prepareHeaders()
                },
                authProvider
              }
              return new SSEClientTransport(new URL(server.baseUrl), options)
            } else {
              throw new Error('Invalid server type')
            }
          } else if (server.command) {
            let cmd = server.command

            // Build a local env for the transport instead of mutating `server.env`. getServerKey(server)
            // serializes server.env, so mutating it here would shift the key after connect — connect-time
            // logs (emitServerLog) and list-changed cache invalidations would then land under a key that
            // getServerLogs / the caches (which see the un-mutated server) never query. Keep server.env
            // untouched so the key stays stable everywhere; see the "deep-copy don't mutate" pattern.
            const connectEnv: Record<string, string> = { ...server.env }

            // Get login shell environment first - needed for command detection and server execution
            // Note: getLoginShellEnvironment() is memoized, so subsequent calls are fast
            const loginShellEnv = await getLoginShellEnvironment()

            // For DXT servers, use resolved configuration with platform overrides and variable substitution
            if (server.dxtPath) {
              const resolvedConfig = this.dxtService.getResolvedMcpConfig(server.dxtPath)
              if (resolvedConfig) {
                cmd = resolvedConfig.command
                args = resolvedConfig.args
                // Merge resolved environment variables with existing ones
                Object.assign(connectEnv, resolvedConfig.env)
                getServerLogger(server).debug(`Using resolved DXT config`, {
                  command: cmd,
                  args
                })
              } else {
                getServerLogger(server).warn(`Failed to resolve DXT config, falling back to manifest values`)
              }
            }

            if (server.command === 'npx') {
              // First, check if npx is available in user's shell environment
              const npxPath = await findCommandInShellEnv('npx', loginShellEnv)

              if (npxPath) {
                // Use system npx
                cmd = npxPath
                getServerLogger(server).debug(`Using system npx`, { command: cmd })
              } else {
                // System npx not found, try bundled bun as fallback
                getServerLogger(server).debug(`System npx not found, checking for bundled bun`)

                if (await isBinaryExists('bun')) {
                  // Fall back to bundled bun
                  cmd = await getBinaryPath('bun')
                  getServerLogger(server).info(`Using bundled bun as fallback (npx not found in PATH)`, {
                    command: cmd
                  })

                  // Transform args for bun x format
                  if (args && args.length > 0) {
                    if (!args.includes('-y')) {
                      args.unshift('-y')
                    }
                    if (!args.includes('x')) {
                      args.unshift('x')
                    }
                  }
                } else {
                  // Neither npx nor bun available
                  throw new Error(
                    'npx not found in PATH and bundled bun is not available. This may indicate an installation issue.\n' +
                      'Please either:\n' +
                      '1. Install Node.js (which includes npx) from https://nodejs.org\n' +
                      '2. Run the MCP dependencies installer from Settings\n' +
                      '3. Restart the application if you recently installed Node.js'
                  )
                }
              }

              if (server.registryUrl) {
                connectEnv.NPM_CONFIG_REGISTRY = server.registryUrl

                // if the server name is mcp-auto-install, use the mcp-registry.json file in the bin directory
                if (server.name.includes('mcp-auto-install')) {
                  const binPath = await getBinaryPath()
                  makeSureDirExists(binPath)
                  connectEnv.MCP_REGISTRY_PATH = path.join(binPath, '..', 'config', 'mcp-registry.json')
                }
              }
            } else if (server.command === 'uvx' || server.command === 'uv') {
              // First, check if uvx/uv is available in user's shell environment
              const uvPath = await findCommandInShellEnv(server.command, loginShellEnv)

              if (uvPath) {
                // Use system uvx/uv
                cmd = uvPath
                getServerLogger(server).debug(`Using system ${server.command}`, { command: cmd })
              } else {
                // System command not found, try bundled version as fallback
                getServerLogger(server).debug(`System ${server.command} not found, checking for bundled version`)

                if (await isBinaryExists(server.command)) {
                  // Fall back to bundled version
                  cmd = await getBinaryPath(server.command)
                  getServerLogger(server).info(`Using bundled ${server.command} as fallback (not found in PATH)`, {
                    command: cmd
                  })
                } else {
                  // Neither system nor bundled available
                  throw new Error(
                    `${server.command} not found in PATH and bundled version is not available. This may indicate an installation issue.\n` +
                      'Please either:\n' +
                      '1. Install uv from https://github.com/astral-sh/uv\n' +
                      '2. Run the MCP dependencies installer from Settings\n' +
                      `3. Restart the application if you recently installed ${server.command}`
                  )
                }
              }

              if (server.registryUrl) {
                connectEnv.UV_DEFAULT_INDEX = server.registryUrl
                connectEnv.PIP_INDEX_URL = server.registryUrl
              }
            }

            getServerLogger(server).debug(`Starting server`, { command: cmd, args })

            // Bun not support proxy https://github.com/oven-sh/bun/issues/16812
            if (cmd.includes('bun')) {
              removeEnvProxy(loginShellEnv)
            }

            const transportOptions: StdioServerParameters = {
              command: cmd,
              args,
              env: {
                ...loginShellEnv,
                ...connectEnv
              },
              stderr: 'pipe'
            }

            // For DXT servers, set the working directory to the extracted path
            if (server.dxtPath) {
              transportOptions.cwd = server.dxtPath
              getServerLogger(server).debug(`Setting working directory for DXT server`, {
                cwd: server.dxtPath
              })
            }

            const stdioTransport = new StdioClientTransport(transportOptions)
            stdioTransport.stderr?.on('data', (data) => {
              const msg = data.toString()
              getServerLogger(server).debug(`Stdio stderr`, { data: msg })
              this.emitServerLog(server, {
                timestamp: Date.now(),
                level: 'stderr',
                message: msg.trim(),
                source: 'stdio'
              })
            })
            // StdioClientTransport does not expose stdout as a readable stream for raw logging
            // (stdout is reserved for JSON-RPC). Avoid attaching a listener that would never fire.
            return stdioTransport
          } else {
            throw new Error('Either baseUrl or command must be provided')
          }
        }

        const handleAuth = async (client: Client, transport: SSEClientTransport | StreamableHTTPClientTransport) => {
          getServerLogger(server).debug(`Starting OAuth flow`)
          // Create an event emitter for the OAuth callback
          const events = new EventEmitter()

          // Create a callback server
          const callbackServer = new CallBackServer({
            port: authProvider.config.callbackPort,
            path: authProvider.config.callbackPath || '/oauth/callback',
            events
          })

          // Set a timeout to close the callback server
          const timeoutId = setTimeout(() => {
            getServerLogger(server).warn(`OAuth flow timed out`)
            void callbackServer.close()
          }, 300000) // 5 minutes timeout

          try {
            // Wait for the authorization code
            const authCode = await callbackServer.waitForAuthCode()
            getServerLogger(server).debug(`Received auth code`)

            // Complete the OAuth flow
            await transport.finishAuth(authCode)

            getServerLogger(server).debug(`OAuth flow completed`)

            const newTransport = await initTransport()
            // Try to connect again
            await client.connect(newTransport)

            getServerLogger(server).debug(`Successfully authenticated`)
          } catch (oauthError) {
            getServerLogger(server).error(`OAuth authentication failed`, oauthError as Error)
            throw new Error(
              `OAuth authentication failed: ${oauthError instanceof Error ? oauthError.message : String(oauthError)}`
            )
          } finally {
            // Clear the timeout and close the callback server
            clearTimeout(timeoutId)
            void callbackServer.close()
          }
        }

        try {
          const transport = await initTransport()
          // Bound the MCP `initialize` request so a non-responsive server fails fast via the
          // SDK's own abort path instead of hanging. Use a 180s floor (activation runs once,
          // generous headroom is cheap) while still honoring larger `server.timeout` values
          // that the user explicitly configured. transport.start() latency remains bounded
          // by the underlying fetch / child_process, matching v1.8.4 behavior.
          const connectOptions: RequestOptions = {
            timeout: Math.max((server.timeout ?? 0) * 1000, MCP_CONNECT_TIMEOUT_FLOOR_MS)
          }
          try {
            await client.connect(transport, connectOptions)
          } catch (error: any) {
            if (
              error instanceof Error &&
              (error.name === 'UnauthorizedError' || error.message.includes('Unauthorized'))
            ) {
              logger.debug(`Authentication required for server: ${server.name}`)
              await handleAuth(client, transport as SSEClientTransport | StreamableHTTPClientTransport)
            } else {
              throw error
            }
          }

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
          this.setupNotificationHandlers(client, server)

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
      } finally {
        // Clean up the pending promise when done
        this.pendingClients.delete(serverKey)
      }
    })()

    // Store the pending promise
    this.pendingClients.set(serverKey, initPromise)

    return initPromise
  }

  /**
   * Set up notification handlers for MCP client
   */
  private setupNotificationHandlers(client: Client, server: McpServer) {
    const serverKey = this.getServerKey(server)
    const cacheService = application.get('CacheService')

    try {
      // Set up tools list changed notification handler
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        logger.debug(`Tools list changed for server: ${server.name}`)
        this._onToolListChanged.fire({ serverId: server.id })
      })

      // Set up resources list changed notification handler
      client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
        logger.debug(`Resources list changed for server: ${server.name}`)
        // Clear resources cache
        cacheService.delete(`mcp:list_resources:${serverKey}`)
      })

      // Set up prompts list changed notification handler
      client.setNotificationHandler(PromptListChangedNotificationSchema, async () => {
        logger.debug(`Prompts list changed for server: ${server.name}`)
        // Clear prompts cache
        cacheService.delete(`mcp:list_prompts:${serverKey}`)
      })

      // Set up resource updated notification handler
      client.setNotificationHandler(ResourceUpdatedNotificationSchema, async () => {
        logger.debug(`Resource updated for server: ${server.name}`)
        // Clear resource-specific caches
        this.clearResourceCaches(serverKey)
      })

      // Set up cancelled notification handler
      client.setNotificationHandler(CancelledNotificationSchema, async (notification) => {
        logger.debug(`Operation cancelled for server: ${server.name}`, notification.params)
      })

      // Set up logging message notification handler
      client.setNotificationHandler(LoggingMessageNotificationSchema, async (notification) => {
        const data = notification.params?.data
        const message = safeSerialize(notification.params.data) ?? 'No data'
        logger.debug(`Message from server ${server.name}: ${message}`)
        if (data) {
          this.emitServerLog(server, {
            timestamp: Date.now(),
            // FIXME: as McpServerLogEntry['level'] not type safe
            level: (notification.params?.level as McpServerLogEntry['level']) || 'info',
            message,
            data: redactSensitive(notification.params?.data),
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
    logger.debug(`Cleared all caches for server`, { serverKey })
  }

  private async getLatestSourcePolicy(server: McpServer): Promise<McpServer> {
    try {
      return await mcpServerService.getById(server.id)
    } catch {
      return server
    }
  }

  private abortActiveToolCalls() {
    for (const [callId, controller] of this.activeToolCalls) {
      controller.abort()
      logger.debug(`Aborted active tool call during MCP runtime stop`, { callId })
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

  async closeClient(serverKey: string) {
    const client = this.clients.get(serverKey)
    if (client) {
      // Remove the client from the cache
      await client.close()
      logger.debug(`Closed server`, { serverKey })
      this.clients.delete(serverKey)
      // Clear all caches for this server
      this.clearServerCache(serverKey)
      this.serverLogs.remove(serverKey)
    } else {
      logger.warn(`No client found for server`, { serverKey })
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
    const server = await this.getServerById(serverId)
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
    const server = await this.getServerById(serverId)
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
        const { items: remainingServers } = await mcpServerService.list({})
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

    // If this is a DXT server, cleanup its directory
    if (server.dxtPath) {
      try {
        const cleaned = this.dxtService.cleanupDxtServer(server.name)
        if (cleaned) {
          getServerLogger(server).debug(`Cleaned up DXT server directory`)
        }
      } catch (error) {
        getServerLogger(server).error(`Failed to cleanup DXT server`, error as Error)
      }
    }
  }

  async restartServer(serverId: string) {
    const server = await this.getServerById(serverId)
    getServerLogger(server).debug(`Restarting server`)
    this.emitServerLog(server, {
      timestamp: Date.now(),
      level: 'info',
      message: 'Restarting server',
      source: 'client'
    })
    await this.closeClientsForServer(server.id)
    // Clear cache before restarting to ensure fresh data
    this.clearServerCache(server)
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
    const server = await this.getServerById(serverId)
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
  public async callTool({ serverId, name, args, callId }: CallToolArgs): Promise<McpCallToolResponse> {
    const server = await this.getServerById(serverId)
    return this.callToolByServer({ server, name, args, callId })
  }

  public async callToolByServer({ server, name, args, callId }: RuntimeCallToolArgs): Promise<McpCallToolResponse> {
    const toolCallId = callId || uuidv4()
    const abortController = new AbortController()
    this.activeToolCalls.set(toolCallId, abortController)

    const callToolFunc = async ({ server, name, args }: RuntimeCallToolArgs) => {
      try {
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
        const sourcePolicy = await this.getLatestSourcePolicy(server)
        if (isMcpToolDisabledBySource(sourcePolicy, { name })) {
          throw new Error(`MCP tool is disabled: ${name}`)
        }
        const client = await this.getOrCreateClient(server)
        const result = await client.callTool({ name, arguments: args }, undefined, {
          onprogress: (process) => {
            getServerLogger(server, { tool: name, callId: toolCallId }).debug(`Progress`, {
              ratio: process.progress / (process.total || 1)
            })
            application.get('WindowManager').broadcastToType(WindowType.Main, IpcChannel.Mcp_Progress, {
              callId: toolCallId,
              progress: process.progress / (process.total || 1)
            } as McpProgressEvent)
          },
          timeout: server.timeout ? server.timeout * 1000 : 60000, // Default timeout of 1 minute,
          // 需要服务端支持: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#timeouts
          // Need server side support: https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle#timeouts
          resetTimeoutOnProgress: server.longRunning,
          maxTotalTimeout: server.longRunning ? 10 * 60 * 1000 : undefined,
          signal: abortController.signal
        })
        return result as McpCallToolResponse
      } catch (error) {
        getServerLogger(server, { tool: name, callId: toolCallId }).error(`Error calling tool`, error as Error)
        throw error
      } finally {
        this.activeToolCalls.delete(toolCallId)
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

  public async getInstallInfo() {
    const dir = await getBinaryPath()
    const uvName = await getBinaryName('uv')
    const bunName = await getBinaryName('bun')
    const uvPath = path.join(dir, uvName)
    const bunPath = path.join(dir, bunName)
    return { dir, uvPath, bunPath }
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
    const server = await this.getServerById(serverId)
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
    const server = await this.getServerById(serverId)
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
    const server = await this.getServerById(serverId)
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
    const server = await this.getServerById(serverId)
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
  public async abortTool(callId: string) {
    const activeToolCall = this.activeToolCalls.get(callId)
    if (activeToolCall) {
      activeToolCall.abort()
      this.activeToolCalls.delete(callId)
      logger.debug(`Aborted tool call`, { callId })
      return true
    } else {
      logger.warn(`No active tool call found for callId`, { callId })
      return false
    }
  }

  /**
   * Get the server version information
   */
  public async getServerVersion(serverId: string): Promise<string | null> {
    const server = await this.getServerById(serverId)
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
