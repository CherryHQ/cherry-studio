import crypto from 'node:crypto'
import fs from 'node:fs/promises'

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { createBuiltinMcpEndpoint, resolveBuiltinExternalMcpServer } from '@main/ai/mcp/servers/factory'
import { BaseService, DependsOn, Emitter, type Event, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import { TraceMethod, withSpanFunc } from '@mcp-trace/trace-core'
import type { CacheMode, Tool } from '@modelcontextprotocol/client'
import { isMcpToolDisabledBySource } from '@shared/ai/tools/mcpSourcePolicy'
import type { SharedCacheKey } from '@shared/data/cache/cacheSchemas'
import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { InputFor, WindowId } from '@shared/ipc/types'
import type { McpPrompt, McpResource, McpServerLogEntry } from '@shared/types/mcp'
import { BuiltinMcpServerNames, isBuiltinMcpServer } from '@shared/utils/mcp'
import { safeSerialize } from '@shared/utils/serialize'
import { app } from 'electron'
import { nanoid } from 'nanoid'
import { v4 as uuidv4 } from 'uuid'
import * as z from 'zod'

import { createExternalMcpConnection } from './connections/ExternalMcpConnection'
import { createInProcessMcpConnection } from './connections/InProcessMcpConnection'
import type { McpConnection, McpConnectionEvents, McpInteractionContext } from './connections/McpConnection'
import type { McpPackageService } from './McpPackageService'
import { ServerLogBuffer } from './ServerLogBuffer'
import type { GetResourceResponse, McpCallToolResponse } from './types'

type CallToolArgs = {
  serverId: string
  name: string
  args: unknown
  callId?: string
  interactionContext?: McpInteractionContext
}
type RuntimeCallToolArgs = Omit<CallToolArgs, 'serverId'> & { server: McpServer }
type McpRuntimeState = McpRuntimeStatus['state']

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
const MCP_CONNECT_TIMEOUT_FLOOR_MS = 180_000
const MCP_INTERACTION_TIMEOUT_MS = 10 * 60 * 1000

interface PendingInteraction {
  windowId: WindowId
  resolve(response: McpInteractionResponse): void
  reject(error: unknown): void
  cleanup(): void
}

type McpInteractionResponse = InputFor<'mcp.interaction.respond'>
type McpToolListChangedEvent = {
  serverId: string
}

export function redactSensitive(input: unknown): unknown {
  const sensitiveKeys = new Set([
    'authorization',
    'Authorization',
    'apiKey',
    'api_key',
    'apikey',
    'token',
    'access_token',
    'requestState'
  ])
  const maxStringLength = 300

  const redact = (value: unknown, seen: WeakSet<object>): unknown => {
    if (value == null) return value
    if (typeof value === 'string') {
      return value.length > maxStringLength
        ? `${value.slice(0, maxStringLength)}…<${value.length - maxStringLength} more>`
        : value
    }
    if (typeof value !== 'object') return value
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    if (Array.isArray(value)) return value.map((item) => redact(item, seen))

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sensitiveKeys.has(key) ? '<redacted>' : redact(item, seen)])
    )
  }

  return redact(input, new WeakSet())
}

function getServerLogger(server: McpServer, extra?: Record<string, unknown>) {
  return loggerService.withContext('McpRuntimeService', {
    serverName: server.name,
    serverId: server.id,
    baseUrl: server.baseUrl,
    type: server.type || (server.command ? 'stdio' : server.baseUrl ? 'http' : 'builtin'),
    ...extra
  })
}

@Injectable('McpRuntimeService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['WindowManager', 'McpPackageService'])
export class McpRuntimeService extends BaseService {
  private connections = new Map<string, McpConnection>()
  private pendingConnections = new Map<string, Promise<McpConnection>>()
  private activeToolCalls = new Map<string, { serverId: string; controller: AbortController }>()
  private pendingInteractions = new Map<string, PendingInteraction>()
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
    this.cancelPendingInteractions()
    await this.waitForPendingConnections()
    await this.closeAllConnections()
    this.pendingConnections.clear()
    this.connections.clear()
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
    const current = cacheService.getShared(key) as McpRuntimeStatus | undefined
    if (current && current.state === state && current.lastError === lastError) return

    cacheService.setShared(key, {
      state,
      lastCheckedAt: Date.now(),
      ...(lastError !== undefined ? { lastError } : {})
    } satisfies McpRuntimeStatus)
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

  private emitServerLog(server: McpServer, entry: McpServerLogEntry): void {
    this.serverLogs.append(this.getServerKey(server), entry)
    application
      .get('IpcApiService')
      .broadcastToType(WindowType.Main, 'mcp.server.log', { ...entry, serverId: server.id })
  }

  public async getServerLogs(serverId: string): Promise<McpServerLogEntry[]> {
    return this.serverLogs.get(this.getServerKey(this.getServerById(serverId)))
  }

  private connectionEvents(server: McpServer): McpConnectionEvents {
    return {
      toolsChanged: (error) => {
        if (error) {
          getServerLogger(server).warn('Failed to refresh changed tools', { error })
          return
        }
        this._onToolListChanged.fire({ serverId: server.id })
      },
      promptsChanged: (error) => {
        if (error) getServerLogger(server).warn('Failed to refresh changed prompts', { error })
      },
      resourcesChanged: (error) => {
        if (error) getServerLogger(server).warn('Failed to refresh changed resources', { error })
      },
      resourceUpdated: () => {
        getServerLogger(server).debug('Resource updated')
      },
      log: (level, source, data) => {
        this.emitServerLog(server, {
          timestamp: Date.now(),
          level: level as McpServerLogEntry['level'],
          message: safeSerialize(data) ?? 'No data',
          data: redactSensitive(data),
          source: source || 'server'
        })
      }
    }
  }

  private async createConnection(server: McpServer): Promise<McpConnection> {
    const connectTimeoutMs = Math.max((server.timeout ?? 0) * 1000, MCP_CONNECT_TIMEOUT_FLOOR_MS)
    const events = this.connectionEvents(server)

    if (
      isBuiltinMcpServer(server) &&
      server.name !== BuiltinMcpServerNames.mcpAutoInstall &&
      server.name !== BuiltinMcpServerNames.nowledgeMem &&
      server.name !== BuiltinMcpServerNames.flomo
    ) {
      return createInProcessMcpConnection({
        appVersion: app.getVersion(),
        endpoint: createBuiltinMcpEndpoint(server.name, [...(server.args || [])], server.env || {}),
        events,
        connectTimeoutMs
      })
    }

    return createExternalMcpConnection({
      server: resolveBuiltinExternalMcpServer(server),
      appVersion: app.getVersion(),
      packageService: this.mcpPackageService,
      events,
      connectTimeoutMs,
      log: {
        debug: (message, data) => getServerLogger(server).debug(message, { data }),
        info: (message, data) => getServerLogger(server).info(message, { data }),
        warn: (message, data) => getServerLogger(server).warn(message, { data }),
        error: (message, error) => getServerLogger(server).error(message, error),
        stdio: (message) => {
          this.emitServerLog(server, {
            timestamp: Date.now(),
            level: 'stderr',
            message,
            source: 'stdio'
          })
        }
      }
    })
  }

  private async getOrCreateConnection(server: McpServer): Promise<McpConnection> {
    if (this.stopping || this.isStopped || this.isDestroyed) throw new Error('MCP runtime is stopping')
    if (!server.isActive) {
      this.setServerStatus(server.id, 'disabled')
      throw new Error(`MCP server ${server.name} is disabled`)
    }

    const serverKey = this.getServerKey(server)
    const pending = this.pendingConnections.get(serverKey)
    if (pending) {
      this.setServerStatus(server.id, 'connecting')
      return pending
    }

    const existing = this.connections.get(serverKey)
    if (existing) {
      try {
        await existing.health()
        this.setServerStatus(server.id, 'connected')
        return existing
      } catch (error) {
        getServerLogger(server).warn('Existing MCP connection failed health check', { error })
        await this.closeConnection(serverKey).catch(() => undefined)
      }
    }

    this.setServerStatus(server.id, 'connecting')
    const initialize = (async () => {
      try {
        const connection = await this.createConnection(server)
        if (this.stopping || this.isStopped || this.isDestroyed) {
          await connection.close()
          throw new Error('MCP runtime is stopping')
        }
        this.connections.set(serverKey, connection)
        this.setServerStatus(server.id, 'connected')
        this.emitServerLog(server, {
          timestamp: Date.now(),
          level: 'info',
          message: `Server connected (${connection.era})`,
          source: 'client'
        })
        return connection
      } catch (error) {
        this.setServerStatus(server.id, 'error', error)
        this.emitServerLog(server, {
          timestamp: Date.now(),
          level: 'error',
          message: `Error activating server: ${error instanceof Error ? error.message : String(error)}`,
          data: redactSensitive(error),
          source: 'client'
        })
        throw error
      } finally {
        this.pendingConnections.delete(serverKey)
      }
    })()

    this.pendingConnections.set(serverKey, initialize)
    return initialize
  }

  public async listTools(serverId: string, cacheMode: CacheMode = 'use'): Promise<Tool[]> {
    const server = this.getServerById(serverId)
    return (await this.getOrCreateConnection(server)).listTools(cacheMode)
  }

  public async callToolById(
    toolId: string,
    params: unknown,
    callId?: string,
    interactionContext?: McpInteractionContext
  ): Promise<McpCallToolResponse> {
    const [serverId, ...toolNameParts] = toolId.split('__')
    if (!serverId || toolNameParts.length === 0) throw new Error(`Invalid tool ID format: ${toolId}`)
    return this.callTool({
      serverId,
      name: toolNameParts.join('__'),
      args: params,
      callId,
      interactionContext
    })
  }

  public async callTool(args: CallToolArgs): Promise<McpCallToolResponse> {
    return this.callToolByServer({ ...args, server: this.getServerById(args.serverId) })
  }

  public async callToolByServer({
    server,
    name,
    args,
    callId,
    interactionContext
  }: RuntimeCallToolArgs): Promise<McpCallToolResponse> {
    const toolCallId = callId || uuidv4()
    const controller = new AbortController()
    this.activeToolCalls.set(toolCallId, { serverId: server.id, controller })

    const run = async (): Promise<McpCallToolResponse> => {
      try {
        let normalizedArgs = args
        if (typeof normalizedArgs === 'string') {
          if (!normalizedArgs.trim()) normalizedArgs = {}
          else {
            try {
              normalizedArgs = JSON.parse(normalizedArgs)
            } catch (error) {
              throw new Error(`Invalid JSON tool arguments for ${name}: ${(error as Error).message}`)
            }
          }
        }

        if (isMcpToolDisabledBySource(this.getLatestSourcePolicy(server), { name })) {
          throw new Error(`MCP tool is disabled: ${name}`)
        }

        getServerLogger(server, { tool: name, callId: toolCallId }).debug('Calling tool', {
          args: redactSensitive(normalizedArgs)
        })
        const connection = await this.getOrCreateConnection(server)
        return await connection.callTool(name, normalizedArgs, {
          signal: controller.signal,
          timeoutMs: server.timeout ? server.timeout * 1000 : 60_000,
          resetTimeoutOnProgress: server.longRunning,
          maxTotalTimeoutMs: server.longRunning ? 10 * 60 * 1000 : undefined,
          interactionContext,
          onProgress: (progress, total) => {
            application.get('IpcApiService').broadcastToType(WindowType.Main, 'mcp.tool.call_progress', {
              callId: toolCallId,
              progress: progress / (total || 1)
            })
          }
        })
      } finally {
        this.activeToolCalls.delete(toolCallId)
      }
    }

    const tracedInput = {
      server: { id: server.id, name: server.name, type: server.type, description: server.description },
      name,
      args
    }
    return withSpanFunc(
      `${server.name}.${name}`,
      'MCP',
      // oxlint-disable-next-line no-unused-vars
      (_recorded: typeof tracedInput) => run(),
      [tracedInput]
    )
  }

  public async listPrompts(serverId: string, cacheMode: CacheMode = 'use'): Promise<McpPrompt[]> {
    const server = this.getServerById(serverId)
    try {
      const prompts = await (await this.getOrCreateConnection(server)).listPrompts(cacheMode)
      return prompts.map((prompt) => ({
        ...prompt,
        id: `p${nanoid()}`,
        serverId: server.id,
        serverName: server.name
      })) as McpPrompt[]
    } catch (error) {
      getServerLogger(server).error('Failed to list prompts', error as Error)
      return []
    }
  }

  @TraceMethod({ spanName: 'getPrompt', tag: 'mcp' })
  public async getPrompt({
    serverId,
    name,
    args
  }: {
    serverId: string
    name: string
    args?: Record<string, string>
  }): Promise<any> {
    const server = this.getServerById(serverId)
    return (await this.getOrCreateConnection(server)).getPrompt(name, args)
  }

  public async listResources(serverId: string, cacheMode: CacheMode = 'use'): Promise<McpResource[]> {
    const server = this.getServerById(serverId)
    try {
      const resources = await (await this.getOrCreateConnection(server)).listResources(cacheMode)
      return resources.map((resource) => ({
        ...resource,
        serverId: server.id,
        serverName: server.name
      })) as McpResource[]
    } catch (error) {
      getServerLogger(server).error('Failed to list resources', error as Error)
      return []
    }
  }

  @TraceMethod({ spanName: 'getResource', tag: 'mcp' })
  public async getResource({ serverId, uri }: { serverId: string; uri: string }): Promise<GetResourceResponse> {
    const server = this.getServerById(serverId)
    const result = await (await this.getOrCreateConnection(server)).readResource(uri)
    return {
      contents: result.contents.map((content) => ({
        ...content,
        serverId: server.id,
        serverName: server.name
      })) as McpResource[]
    }
  }

  public async checkMcpConnectivity(serverId: string): Promise<boolean> {
    const server = this.getServerById(serverId)
    try {
      await (await this.getOrCreateConnection(server)).health()
      this.setServerStatus(server.id, 'connected')
      return true
    } catch (error) {
      await this.closeConnection(this.getServerKey(server)).catch(() => undefined)
      application.get('McpCatalogService').clearSharedToolsCache(server.id)
      this.setServerStatus(server.id, 'error', error)
      return false
    }
  }

  public async getServerVersion(serverId: string): Promise<string | null> {
    try {
      return (await this.getOrCreateConnection(this.getServerById(serverId))).serverVersion
    } catch (error) {
      logger.warn('Failed to read MCP server version', { serverId, error })
      return null
    }
  }

  public async abortTool(callId: string): Promise<boolean> {
    const active = this.activeToolCalls.get(callId)
    if (!active) return false
    active.controller.abort()
    this.activeToolCalls.delete(callId)
    return true
  }

  public requestInteraction({
    windowId,
    topicId,
    kind,
    payload,
    signal
  }: {
    windowId: WindowId
    topicId: string
    kind: 'elicitation' | 'sampling' | 'roots'
    payload: unknown
    signal: AbortSignal
  }): Promise<McpInteractionResponse> {
    if (!application.get('WindowManager').getWindow(windowId)) {
      return Promise.reject(new Error('MCP interaction rejected: the originating window is unavailable'))
    }

    const requestId = uuidv4()
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout)
        signal.removeEventListener('abort', onAbort)
        this.pendingInteractions.delete(requestId)
      }
      const finish = (response: McpInteractionResponse) => {
        cleanup()
        resolve(response)
      }
      const fail = (error: unknown) => {
        cleanup()
        reject(error)
      }
      const onAbort = () => fail(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
      const timeout = setTimeout(() => fail(new Error('MCP interaction timed out')), MCP_INTERACTION_TIMEOUT_MS)

      this.pendingInteractions.set(requestId, { windowId, resolve: finish, reject: fail, cleanup })
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      application.get('IpcApiService').send(windowId, 'mcp.interaction.requested', {
        requestId,
        topicId,
        kind,
        payload
      })
    })
  }

  public async respondInteraction(response: McpInteractionResponse, senderId: WindowId | null): Promise<boolean> {
    const pending = this.pendingInteractions.get(response.requestId)
    if (!pending || !senderId || pending.windowId !== senderId) return false
    pending.resolve(response)
    return true
  }

  private getLatestSourcePolicy(server: McpServer): McpServer {
    try {
      return mcpServerService.getById(server.id)
    } catch {
      return server
    }
  }

  private abortActiveToolCalls(serverId?: string): void {
    for (const [callId, active] of this.activeToolCalls) {
      if (serverId && active.serverId !== serverId) continue
      active.controller.abort()
      this.activeToolCalls.delete(callId)
    }
  }

  private cancelPendingInteractions(): void {
    for (const pending of this.pendingInteractions.values()) {
      pending.reject(new Error('MCP runtime stopped while waiting for interaction authorization'))
    }
  }

  private async waitForPendingConnections(): Promise<void> {
    await Promise.allSettled([...this.pendingConnections.values()])
  }

  private async closeAllConnections(): Promise<void> {
    await Promise.allSettled([...this.connections.keys()].map((key) => this.closeConnection(key)))
  }

  private async closeConnection(serverKey: string): Promise<void> {
    const connection = this.connections.get(serverKey)
    if (!connection) return
    this.connections.delete(serverKey)
    await connection.close()
    this.serverLogs.remove(serverKey)
  }

  private async closeConnectionsForServer(serverId: string): Promise<void> {
    this.abortActiveToolCalls(serverId)
    const pendingKeys = [...this.pendingConnections.keys()].filter((key) => this.isServerKeyForId(key, serverId))
    await Promise.all(pendingKeys.map((key) => this.pendingConnections.get(key)?.catch(() => undefined)))
    const keys = [...this.connections.keys()].filter((key) => this.isServerKeyForId(key, serverId))
    await Promise.all(keys.map((key) => this.closeConnection(key)))
  }

  public async stopServer(serverId: string): Promise<void> {
    const server = this.getServerById(serverId)
    await this.closeConnectionsForServer(server.id)
    application.get('McpCatalogService').clearSharedToolsCache(server.id)
    this.setServerStatus(server.id, 'disabled')
  }

  public async restartServer(serverId: string): Promise<void> {
    const server = this.getServerById(serverId)
    await this.closeConnectionsForServer(server.id)
    application.get('McpCatalogService').clearSharedToolsCache(server.id)
    try {
      await this.getOrCreateConnection(server)
      await application.get('McpCatalogService').refreshTools(server.id)
    } catch (error) {
      this.setServerStatus(server.id, 'error', error)
      throw error
    }
  }

  public async removeServer(serverId: string): Promise<void> {
    const server = this.getServerById(serverId)
    try {
      await this.closeConnectionsForServer(server.id)
    } finally {
      application.get('McpCatalogService').clearSharedToolsCache(server.id)
      this.setServerStatus(server.id, 'disabled')
    }

    if (server.baseUrl) {
      try {
        const { items } = mcpServerService.list({})
        if (!items.some((item) => item.id !== server.id && item.baseUrl === server.baseUrl)) {
          const hash = crypto.createHash('md5').update(server.baseUrl).digest('hex')
          await fs.unlink(application.getPath('feature.mcp.oauth', `${hash}_oauth.json`))
        }
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          getServerLogger(server).error('Failed to clean OAuth storage', error as Error)
        }
      }
    }

    if (server.dxtPath) this.mcpPackageService.cleanupPackageServer(server.name)
  }
}
