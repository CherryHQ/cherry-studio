import type { CacheMode, Tool } from '@modelcontextprotocol/client'

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { withSpanFunc } from '@main/ai/observability'
import { BaseService, DependsOn, Emitter, type Event, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isMcpToolDisabledBySource } from '@shared/ai/tools/mcpSourcePolicy'
import type { SharedCacheKey } from '@shared/data/cache/cacheSchemas'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpPrompt, McpResource, McpTool } from '@shared/types/mcp'

import { buildMcpToolWireId } from './mcpToolId'

const logger = loggerService.withContext('McpCatalogService')
const mcpToolsCacheKey = (serverId: string): SharedCacheKey => `mcp.tools.${serverId}`
const emptyToolsRetryCacheKey = (serverId: string) => `mcp:tools-empty-retry:${serverId}`
const PREWARM_CONCURRENCY = 3
const FAILED_TOOLS_RETRY_MS = 30 * 1000

type ListToolsOptions = { includeDisabled?: boolean; cacheMode?: CacheMode }

@Injectable('McpCatalogService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['McpRuntimeService'])
export class McpCatalogService extends BaseService {
  private prewarmCancelled = false
  /** Single-flights `warmToolsCache` refreshes per serverId so concurrent sessions warming
   *  the same server at once don't each open a connection to it. */
  private readonly warmRefreshInFlight = new Map<string, Promise<void>>()
  private readonly projectionRevisions = new Map<string, number>()

  /**
   * Fires when a server's `mcp.tools.<serverId>` shared-cache **content** actually changes
   * (see `writeToolsCache`). This is the push-invalidation channel that keeps per-session
   * tool snapshots consistent with the cache: the Claude Agent SDK snapshots each MCP bridge
   * server's tools once per session and never re-reads on its own, so the bridge
   * (`createMcpBridgeServer`) subscribes here and relays every cache change as an MCP
   * `tools/list_changed` notification, prompting the SDK to re-list against the fresh cache.
   *
   * The runtime event carries the SDK's refreshed catalog; this event only announces
   * changes to the application projection, so consumers must not trigger another refresh.
   *
   * Lifecycle-registered so service stop/destroy drops all listeners even if a bridge's
   * own `onclose` unsubscribe never ran (e.g. a session torn down abnormally).
   */
  private readonly _onToolsCacheUpdated = this.registerDisposable(new Emitter<{ serverId: string }>())
  readonly onToolsCacheUpdated: Event<{ serverId: string }> = this._onToolsCacheUpdated.event

  protected async onInit(): Promise<void> {
    this.prewarmCancelled = false
    this.registerDisposable(
      application.get('McpRuntimeService').onToolListChanged(({ serverId, tools }) => {
        try {
          const server = this.getServerById(serverId)
          if (server.isActive) this.writeToolsCache(serverId, this.projectTools(server, tools))
        } catch (error) {
          logger.warn('Failed to project changed tools', { serverId, error })
        }
      })
    )
  }

  protected async onReady(): Promise<void> {
    void this.prewarmActiveServerTools()
  }

  protected async onStop(): Promise<void> {
    this.prewarmCancelled = true
  }

  private getServerById(serverId: string): McpServer {
    return mcpServerService.getById(serverId)
  }

  /**
   * Sole write funnel for the `mcp.tools.<serverId>` shared cache — every producer
   * (refresh, prewarm, failure/inactive clearing) lands here, which is what lets this
   * single point drive `onToolsCacheUpdated`.
   *
   * Backoff state is maintained here too, so clearing or replacing the shared cache cannot
   * leave a stale retry backoff marker behind. Change detection compares effective content
   * (`undefined` reads as `[]`, so first-write of an empty list is not a "change"): consumers
   * debounce on it because a spurious fire makes the SDK re-list and active sessions rebuild
   * their host-side tool metadata and policy snapshot. Stringify order-sensitivity is fine —
   * lists are rebuilt from the same upstream source, so key/element order is stable across refreshes.
   */
  private writeToolsCache(serverId: string, tools: McpTool[], emptyRetryMs = 0): void {
    this.projectionRevisions.set(serverId, (this.projectionRevisions.get(serverId) ?? 0) + 1)
    const cacheService = application.get('CacheService')
    const cacheKey = mcpToolsCacheKey(serverId)
    const previous = cacheService.getShared(cacheKey) as McpTool[] | undefined
    cacheService.setShared(cacheKey, tools)
    if (tools.length === 0 && emptyRetryMs > 0) {
      cacheService.set(emptyToolsRetryCacheKey(serverId), true, emptyRetryMs)
    } else {
      cacheService.delete(emptyToolsRetryCacheKey(serverId))
    }
    if (JSON.stringify(previous ?? []) !== JSON.stringify(tools)) {
      this._onToolsCacheUpdated.fire({ serverId })
    }
  }

  public clearSharedToolsCache(serverId: string): void {
    this.warmRefreshInFlight.delete(serverId)
    this.writeToolsCache(serverId, [])
  }

  private runtimeService() {
    return application.get('McpRuntimeService')
  }

  private filterEnabledTools(server: McpServer, tools: McpTool[]): McpTool[] {
    let latestServer: McpServer
    try {
      latestServer = this.getServerById(server.id)
    } catch {
      latestServer = server
    }
    return tools.filter((tool) => !isMcpToolDisabledBySource(latestServer, tool))
  }

  private projectTools(server: McpServer, tools: Tool[]): McpTool[] {
    return tools.map((tool) => ({
      ...tool,
      id: buildMcpToolWireId({ serverId: server.id, serverName: server.name, toolName: tool.name }),
      serverId: server.id,
      serverName: server.name,
      type: 'mcp'
    }))
  }

  private async listToolsImpl(server: McpServer, cacheMode: CacheMode): Promise<McpTool[]> {
    try {
      const tools = await application.get('McpRuntimeService').listTools(server.id, cacheMode)
      return this.projectTools(server, tools)
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

    const listFunc = (server: McpServer) => this.listToolsImpl(server, options.cacheMode ?? 'use')
    const revision = this.projectionRevisions.get(server.id)

    try {
      const tools = await withSpanFunc(`${server.name}.ListTool`, 'MCP', listFunc, [server])
      if (this.projectionRevisions.get(server.id) !== revision) return this.listTools(server.id, options)
      this.writeToolsCache(server.id, tools)
      this.runtimeService().setServerStatus(server.id, 'connected')
      return options.includeDisabled ? tools : this.filterEnabledTools(server, tools)
    } catch (error) {
      if (this.projectionRevisions.get(server.id) !== revision) throw error
      this.writeToolsCache(server.id, [], FAILED_TOOLS_RETRY_MS)
      this.runtimeService().setServerStatus(server.id, 'error', error)
      throw error
    }
  }

  /**
   * Read a server's tools from the shared `mcp.tools.<serverId>` cache. This is a
   * **cache-only** facade: it never connects to the upstream MCP server, so a dead or
   * slow server can't block the agent/chat startup hot path that lists tools (issue
   * #16242). Connecting + listing is owned by `refreshTools` and the background warmers
   * (`prewarmActiveServerTools`, the `onToolListChanged` refresh, the renderer's
   * on-demand `refreshTools`). Cold cache → `[]` plus a non-blocking refresh kick; when
   * that refresh lands, `writeToolsCache` fires `onToolsCacheUpdated`, so snapshot
   * consumers (the SDK bridge) re-read within the same session instead of waiting for
   * the next one.
   */
  public listTools(serverId: string, options: ListToolsOptions = {}): McpTool[] {
    const cached = application.get('CacheService').getShared(mcpToolsCacheKey(serverId)) as McpTool[] | undefined
    // `undefined` = never warmed (distinct from a warmed-but-empty/dead server that holds `[]`).
    // Kick a one-shot, non-blocking refresh so the next read is populated; dead servers keep
    // their `[]` and are not re-probed here. Routed through the single-flighted warm so a kick
    // racing an in-flight session warm doesn't open a second connection to the same server.
    if (cached === undefined) void this.warmToolsCache(serverId)
    const tools = cached ?? []
    if (options.includeDisabled || tools.length === 0) return tools
    let server: McpServer | undefined
    try {
      server = this.getServerById(serverId)
    } catch {
      server = undefined
    }
    return server ? tools.filter((tool) => !isMcpToolDisabledBySource(server, tool)) : tools
  }

  /** Revalidate the application snapshot through the SDK's cache; only failed reads back off. */
  public async warmToolsCache(serverId: string): Promise<void> {
    if (application.get('CacheService').has(emptyToolsRetryCacheKey(serverId))) {
      logger.debug('Skipping MCP tools warm during retry backoff', { serverId })
      return
    }
    let refresh = this.warmRefreshInFlight.get(serverId)
    if (!refresh) {
      refresh = this.getCurrentTools(serverId, { includeDisabled: true })
        .then(() => undefined)
        .catch((error) => {
          logger.warn('Failed to warm tools cache', { serverId, error })
        })
        .finally(() => {
          if (this.warmRefreshInFlight.get(serverId) === refresh) this.warmRefreshInFlight.delete(serverId)
        })
      this.warmRefreshInFlight.set(serverId, refresh)
    }
    await refresh
  }

  // Protocol freshness stays with the connection's SDK cache.
  public async listResources(serverId: string): Promise<McpResource[]> {
    return this.runtimeService().listResources(serverId)
  }

  public async listResourceTemplates(serverId: string) {
    return this.runtimeService().listResourceTemplates(serverId)
  }

  public async listPrompts(serverId: string): Promise<McpPrompt[]> {
    return this.runtimeService().listPrompts(serverId)
  }

  public async refreshTools(serverId: string): Promise<void> {
    await this.getCurrentTools(serverId, { includeDisabled: true, cacheMode: 'refresh' })
  }

  public async getCurrentTools(serverId: string, options: ListToolsOptions = {}): Promise<McpTool[]> {
    return this.listToolsForServer(this.getServerById(serverId), options)
  }

  private async prewarmActiveServerTools(): Promise<void> {
    try {
      const { items: servers } = mcpServerService.list({ isActive: true })
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
        })
      }
    } catch (error) {
      logger.warn('Failed to load active MCP servers for tools prewarm', { error })
    }
  }
}
