import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Emitter, type Event, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { withSpanFunc } from '@mcp-trace/trace-core'
import type { Tool as SDKTool } from '@modelcontextprotocol/sdk/types'
import { isMcpToolDisabledBySource } from '@shared/ai/tools/mcpSourcePolicy'
import { buildFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { SharedCacheKey } from '@shared/data/cache/cacheSchemas'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpPrompt, McpResource, McpTool } from '@shared/types/mcp'
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
  /** Single-flights `warmToolsCache` refreshes per serverId so concurrent sessions warming
   *  the same server at once don't each open a connection to it. */
  private readonly warmRefreshInFlight = new Map<string, Promise<void>>()
  /**
   * Servers whose most recent refresh attempt failed without leaving a usable (populated or
   * legitimately-empty) snapshot. `listToolsWithStatus` reads this to report `fresh: false`,
   * which is what lets the registry mark a namespace as NOT refreshed (so stale tools survive)
   * and broadcast the `mcp.server.tools_stale` warning for a genuine disconnect. A server is
   * removed from this set as soon as any refresh succeeds (including a successful empty one).
   */
  private readonly staleServers = new Set<string>()

  /**
   * Fires when a server's `mcp.tools.<serverId>` shared-cache **content** actually changes
   * (see `writeToolsCache`). This is the push-invalidation channel that keeps per-session
   * tool snapshots consistent with the cache: the Claude Agent SDK snapshots each MCP bridge
   * server's tools once per session and never re-reads on its own, so the bridge
   * (`createSdkMcpServerInstance`) subscribes here and relays every cache change as an MCP
   * `tools/list_changed` notification, prompting the SDK to re-list against the fresh cache.
   *
   * Deliberately a NEW event, not a re-fire of `McpRuntimeService.onToolListChanged`: that
   * event means "upstream says its list changed → go refresh the cache" and is consumed by
   * `onInit` → `refreshTools`, whose refresh *writes* the cache. Re-firing it from the write
   * path would loop (refresh → write → fire → refresh). This event is terminal: consumers
   * may only re-READ the cache, never write it back.
   *
   * Lifecycle-registered so service stop/destroy drops all listeners even if a bridge's
   * own `onclose` unsubscribe never ran (e.g. a session torn down abnormally).
   */
  private readonly _onToolsCacheUpdated = this.registerDisposable(new Emitter<{ serverId: string }>())
  readonly onToolsCacheUpdated: Event<{ serverId: string }> = this._onToolsCacheUpdated.event

  protected async onInit(): Promise<void> {
    this.prewarmCancelled = false
    this.registerDisposable(
      application.get('McpRuntimeService').onToolListChanged(({ serverId }) => {
        void this.refreshTools(serverId).catch((error) => {
          logger.warn('Failed to refresh tools after tool list changed notification', { serverId, error })
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

  private getServerById(serverId: string): McpServer {
    return mcpServerService.getById(serverId)
  }

  /**
   * Sole write funnel for the `mcp.tools.<serverId>` shared cache — every producer
   * (refresh, prewarm, failure/inactive clearing) lands here, which is what lets this
   * single point drive `onToolsCacheUpdated`.
   *
   * Change detection compares effective content (`undefined` reads as `[]`, so first-write
   * of an empty list is not a "change"): consumers debounce on it, and a spurious fire only
   * costs the SDK a redundant re-list. Stringify order-sensitivity is fine — lists are
   * rebuilt from the same upstream source, so key/element order is stable across refreshes.
   */
  private writeToolsCache(serverId: string, tools: McpTool[]): void {
    const cacheService = application.get('CacheService')
    const cacheKey = mcpToolsCacheKey(serverId)
    const previous = cacheService.getShared(cacheKey) as McpTool[] | undefined
    cacheService.setShared(cacheKey, tools)
    if (JSON.stringify(previous ?? []) !== JSON.stringify(tools)) {
      this._onToolsCacheUpdated.fire({ serverId })
    }
  }

  public clearToolsCache(server: McpServer): void {
    const serverKey = application.get('McpRuntimeService').getServerKey(server)
    application.get('CacheService').delete(`mcp:list_tool:${serverKey}`)
  }

  public clearSharedToolsCache(serverId: string): void {
    this.staleServers.delete(serverId)
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
      this.staleServers.delete(server.id)
      this.writeToolsCache(server.id, tools)
      this.runtimeService().setServerStatus(server.id, 'connected')
      return options.includeDisabled ? tools : this.filterEnabledTools(server, tools)
    } catch (error) {
      this.runtimeService().setServerStatus(server.id, 'error', error)
      // Preserve last-known-good data: if a prior snapshot exists, leave it untouched and only
      // mark the server stale so consumers skip eviction and surface a warning. On a COLD failure
      // (no prior snapshot) write an empty sentinel so the cache-only hot path reads `[]` instead of
      // `undefined` — otherwise every later AI request re-kicks a warm and reconnects to / restarts a
      // dead server. The cold sentinel is distinct from a successful empty refresh (which removes the
      // stale mark); the sole difference is the `staleServers` flag, which `listToolsWithStatus` reads.
      const cacheService = application.get('CacheService')
      const prior = cacheService.getShared(mcpToolsCacheKey(server.id)) as McpTool[] | undefined
      this.staleServers.add(server.id)
      if (prior === undefined) {
        this.writeToolsCache(server.id, [])
      }
      throw error
    }
  }

  /**
   * Cache-only read that also reports whether the returned snapshot is *fresh* — i.e. it
   * came from a successful refresh (live or a populated/stale-free cache), as opposed to
   * a cold miss (`undefined`) or a failed refresh with no usable snapshot. `fresh: false`
   * is the signal the registry uses to (a) keep last-known-good tools registered instead
   * of evicting them and (b) broadcast `mcp.server.tools_stale` for a genuine disconnect.
   *
   * A *successful empty* refresh is `fresh: true` even though `tools === []`: the server
   * really has no tools (or the user disabled its last one), so the registry must treat the
   * namespace as refreshed and drop the now-removed/disabled entries. The only `fresh: false`
   * cases are cold (never warmed) and post-failure-with-no-prior-snapshot.
   */
  public listToolsWithStatus(serverId: string, options: ListToolsOptions = {}): { tools: McpTool[]; fresh: boolean } {
    const cached = application.get('CacheService').getShared(mcpToolsCacheKey(serverId)) as McpTool[] | undefined
    // `undefined` = never warmed (distinct from a warmed-but-empty/dead server that holds `[]`).
    // Kick a one-shot, non-blocking refresh so the next read is populated; dead servers keep
    // their `[]` and are not re-probed here. Routed through the single-flighted warm so a kick
    // racing an in-flight session warm doesn't open a second connection to the same server.
    if (cached === undefined) void this.warmToolsCache(serverId)
    const tools = cached ?? []
    // Cold miss, or a recent refresh failure that left no usable snapshot → not fresh.
    const fresh = cached !== undefined && !this.staleServers.has(serverId)
    if (options.includeDisabled || tools.length === 0) return { tools, fresh }
    let server: McpServer | undefined
    try {
      server = this.getServerById(serverId)
    } catch {
      server = undefined
    }
    return { tools: server ? tools.filter((tool) => !isMcpToolDisabledBySource(server, tool)) : tools, fresh }
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
    return this.listToolsWithStatus(serverId, options).tools
  }

  /**
   * Warm a server's tools cache, awaiting a live `refreshTools` when the cache is cold
   * (`undefined`) or warmed-but-empty (`[]`); a populated cache resolves immediately.
   * Never rejects — a dead server degrades to a warmed-but-empty cache.
   *
   * Consumer: the bounded pre-warm in `buildClaudeCodeSessionSettings`, which needs the
   * cache-only session-build reads (approval descriptors, tool-card metadata) to see the
   * agent's tools. This is also the only path that re-probes a warmed-but-empty cache —
   * `listTools` deliberately never re-kicks `[]` (dead servers must not be re-probed on
   * the hot path), so without this probe a server that died once would never be retried
   * and could never fire the `onToolsCacheUpdated` recovery notification. Do not demote
   * this to a pure latency optimization.
   *
   * NOT used by the SDK bridge's ListTools: the bridge reads cache-only and relies on
   * `onToolsCacheUpdated` → `tools/list_changed` to converge, so it must never block on a
   * connect (issue #16242). Re-probing a genuinely-empty server once per warm is an
   * accepted cost.
   */
  public async warmToolsCache(serverId: string): Promise<void> {
    const cached = application.get('CacheService').getShared(mcpToolsCacheKey(serverId)) as McpTool[] | undefined
    if (cached !== undefined && cached.length > 0) return
    let refresh = this.warmRefreshInFlight.get(serverId)
    if (!refresh) {
      refresh = this.refreshTools(serverId)
        .catch((error) => {
          logger.warn('Failed to warm tools cache', { serverId, error })
        })
        .finally(() => {
          this.warmRefreshInFlight.delete(serverId)
        })
      this.warmRefreshInFlight.set(serverId, refresh)
    }
    await refresh
  }

  // Resources and prompts are owned by McpRuntimeService (cached under `mcp:list_*` and exposed
  // over renderer IPC); the catalog delegates so SDK-runtime consumers keep one MCP read facade.
  public async listResources(serverId: string): Promise<McpResource[]> {
    return this.runtimeService().listResources(serverId)
  }

  public async listPrompts(serverId: string): Promise<McpPrompt[]> {
    return this.runtimeService().listPrompts(serverId)
  }

  public async refreshTools(serverId: string): Promise<void> {
    const server = this.getServerById(serverId)
    this.clearToolsCache(server)
    await this.listToolsForServer(server, { includeDisabled: true })
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
          // Do NOT clear cache on prewarm failure — preserves last-known-good tools.
          // Cache is only cleared on explicit refresh or server deactivation.
        })
      }
    } catch (error) {
      logger.warn('Failed to load active MCP servers for tools prewarm', { error })
    }
  }
}
