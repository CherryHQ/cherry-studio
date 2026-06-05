import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { withSpanFunc } from '@mcp-trace/trace-core'
import type { Tool as SDKTool } from '@modelcontextprotocol/sdk/types'
import { isMcpToolDisabledBySource } from '@shared/ai/tools/mcpSourcePolicy'
import type { SharedCacheKey } from '@shared/data/cache/cacheSchemas'
import { buildFunctionCallToolName } from '@shared/mcp'
import type { McpServer, McpTool } from '@types'
import * as z from 'zod'

const logger = loggerService.withContext('McpCatalogService')
const mcpToolsCacheKey = (serverId: string): SharedCacheKey => `mcp.tools.${serverId}` as SharedCacheKey
const PREWARM_CONCURRENCY = 3

type CachedFunction<T extends unknown[], R> = (...args: T) => Promise<R>
type ListToolsOptions = { includeDisabled?: boolean }

/** JSON-Schema validator for MCP tool input/output schemas. `loose()` keeps
 *  protocol extensions while normalizing missing fields for renderer reads. */
const MCP_TOOL_INPUT_SCHEMA = z
  .object({
    type: z.literal('object'),
    properties: z.object({}).loose().optional(),
    required: z.array(z.string()).optional()
  })
  .loose()
  .transform((schema) => {
    if (!schema.properties) schema.properties = {}
    if (!schema.required) schema.required = []
    return schema
  })

const MCP_TOOL_OUTPUT_SCHEMA = z
  .object({
    type: z.literal('object'),
    properties: z.object({}).loose().optional(),
    required: z.array(z.string()).optional()
  })
  .loose()

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
      if (cachedData) return cachedData
    }

    const start = Date.now()
    const result = await fn(...args)
    cacheService.set(cacheKey, result, ttl)
    logger.debug(`${logPrefix} cached`, { cacheKey, ttlMs: ttl, durationMs: Date.now() - start })
    return result
  }
}

@Injectable('McpCatalogService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['McpRuntimeService'])
export class McpCatalogService extends BaseService {
  private prewarmCancelled = false

  protected async onInit(): Promise<void> {
    this.prewarmCancelled = false
    this.registerDisposable(
      application.get('McpRuntimeService').onToolListChanged(({ serverId }) => {
        void this.refreshTools(serverId).catch((error) => {
          logger.warn('Failed to refresh tools after tool list changed notification', { serverId, error })
          this.clearSharedToolsCache(serverId)
        })
      })
    )
  }

  protected async onReady(): Promise<void> {
    void this.prewarmActiveServerTools()
  }

  protected async onStop(): Promise<void> {
    this.prewarmCancelled = true
  }

  private async getServerById(serverId: string): Promise<McpServer> {
    return await mcpServerService.getById(serverId)
  }

  private writeToolsCache(serverId: string, tools: McpTool[]): void {
    application.get('CacheService').setShared(mcpToolsCacheKey(serverId), tools)
  }

  public clearToolsCache(server: McpServer): void {
    const serverKey = application.get('McpRuntimeService').getServerKey(server)
    application.get('CacheService').delete(`mcp:list_tool:${serverKey}`)
  }

  public clearSharedToolsCache(serverId: string): void {
    this.writeToolsCache(serverId, [])
  }

  private runtimeService() {
    return application.get('McpRuntimeService')
  }

  private async filterEnabledTools(server: McpServer, tools: McpTool[]): Promise<McpTool[]> {
    const latestServer = await this.getServerById(server.id).catch(() => server)
    return tools.filter((tool) => !isMcpToolDisabledBySource(latestServer, tool))
  }

  private async listToolsImpl(server: McpServer): Promise<McpTool[]> {
    try {
      const { tools } = await application.get('McpRuntimeService').withClient(server.id, (client) => client.listTools())
      return tools.map((tool: SDKTool) => {
        const serverTool: McpTool = {
          ...tool,
          inputSchema: MCP_TOOL_INPUT_SCHEMA.parse(tool.inputSchema),
          outputSchema: tool.outputSchema ? MCP_TOOL_OUTPUT_SCHEMA.parse(tool.outputSchema) : undefined,
          id: buildFunctionCallToolName(server.name, tool.name),
          serverId: server.id,
          serverName: server.name,
          type: 'mcp'
        }
        logger.debug('Listing tool', {
          serverId: server.id,
          serverName: server.name,
          toolName: tool.name,
          toolId: serverTool.id
        })
        return serverTool
      })
    } catch (error: unknown) {
      logger.error('Failed to list tools', error as Error, { serverId: server.id, serverName: server.name })
      throw error
    }
  }

  private async listToolsForServer(server: McpServer, options: ListToolsOptions = {}): Promise<McpTool[]> {
    if (!server.isActive) {
      this.writeToolsCache(server.id, [])
      this.runtimeService().setServerStatus(server.id, 'disabled')
      return []
    }

    const listFunc = (server: McpServer) => {
      const cachedListTools = withCache<[McpServer], McpTool[]>(
        this.listToolsImpl.bind(this),
        (server) => {
          const serverKey = application.get('McpRuntimeService').getServerKey(server)
          return `mcp:list_tool:${serverKey}`
        },
        5 * 60 * 1000,
        `[MCP] Tools from ${server.name}`
      )

      return cachedListTools(server)
    }

    try {
      const tools = await withSpanFunc(`${server.name}.ListTool`, 'MCP', listFunc, [server])
      this.writeToolsCache(server.id, tools)
      this.runtimeService().setServerStatus(server.id, 'connected')
      return options.includeDisabled ? tools : await this.filterEnabledTools(server, tools)
    } catch (error) {
      this.writeToolsCache(server.id, [])
      this.runtimeService().setServerStatus(server.id, 'error', error)
      throw error
    }
  }

  public async listTools(serverId: string, options: ListToolsOptions = {}): Promise<McpTool[]> {
    const server = await this.getServerById(serverId)
    return this.listToolsForServer(server, options)
  }

  public async refreshTools(serverId: string): Promise<void> {
    const server = await this.getServerById(serverId)
    this.clearToolsCache(server)
    await this.listToolsForServer(server, { includeDisabled: true })
  }

  private async prewarmActiveServerTools(): Promise<void> {
    try {
      const { items: servers } = await mcpServerService.list({ isActive: true })
      for (let index = 0; index < servers.length; index += PREWARM_CONCURRENCY) {
        if (this.prewarmCancelled || this.isStopped || this.isDestroyed) return
        const batch = servers.slice(index, index + PREWARM_CONCURRENCY)
        const results = await Promise.allSettled(
          batch.map((server) => this.listToolsForServer(server, { includeDisabled: true }))
        )
        results.forEach((result, resultIndex) => {
          if (result.status === 'fulfilled') return
          const server = batch[resultIndex]
          logger.warn('Failed to prewarm MCP tools catalog', {
            serverId: server.id,
            serverName: server.name,
            error: result.reason
          })
          this.clearSharedToolsCache(server.id)
        })
      }
    } catch (error) {
      logger.warn('Failed to load active MCP servers for tools prewarm', { error })
    }
  }
}
