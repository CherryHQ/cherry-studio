import { type Progress, type ReadResourceResult, Server, type Tool } from '@modelcontextprotocol/server'

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { isMcpCancellation } from '@main/ai/mcp/mcpAbort'
import { chatErrorContext } from '@main/ai/utils/chatErrorContext'
import { redactToShape } from '@main/ai/utils/redactToShape'
import type { McpServer as McpServerEntity } from '@shared/data/types/mcpServer'
import type { McpResource, McpTool } from '@shared/types/mcp'

import type { McpInteractionContext, McpResourceObservation } from './connections/McpConnection'
import { mcpLegacyResult } from './toolResult'

const logger = loggerService.withContext('McpBridge')

export interface McpBridgeOptions {
  interactionContext?: McpInteractionContext
  /**
   * Declare `tools.listChanged` and relay cache updates as `tools/list_changed`.
   *
   * Only true for a transport that can actually carry a server→client notification. The
   * stateless HTTP proxy cannot: every request builds and closes its own bridge, so there
   * is no stream to deliver on and the capability would be a promise the client trusts and
   * never receives.
   */
  listChanged?: boolean
}

const CATALOG_FIELDS = ['id', 'serverId', 'serverName', 'type'] as const

function stripCatalogFields<T extends object>(entry: T): Omit<T, (typeof CATALOG_FIELDS)[number]> {
  const result: Record<string, unknown> = { ...(entry as Record<string, unknown>) }
  for (const field of CATALOG_FIELDS) delete result[field]
  return result as Omit<T, (typeof CATALOG_FIELDS)[number]>
}

function toSdkTool(tool: McpTool): Tool {
  // V2 permits any JSON output and newer schema dialects. Main validates the original
  // schema; advertising it to a v1 client would trigger its incompatible validator.
  const sdkTool: Tool = stripCatalogFields(tool)
  delete sdkTool.outputSchema
  return sdkTool
}

// McpResource carries both list metadata and read payload fields; a read content
// block must collapse to the SDK's text-or-blob union, keyed on whichever is present.
function toSdkResourceContents(content: McpResource): ReadResourceResult['contents'][number] {
  const base: { uri: string; mimeType?: string } = { uri: content.uri }
  if (content.mimeType) base.mimeType = content.mimeType
  if (typeof content.text === 'string') return { ...base, text: content.text }
  if (typeof content.blob === 'string') return { ...base, blob: content.blob }
  // Neither text nor blob isn't representable in the protocol; surface as empty text.
  return { ...base, text: '' }
}

/**
 * Creates one protocol instance of an in-process bridge that proxies tool/resource/prompt
 * list and call requests to an existing MCP server managed by `McpRuntimeService`. It uses
 * the low-level `Server` because the proxied catalogs are only known at request time.
 *
 * Two consumers: agent runtimes (one instance per runtime transport), and the API gateway's
 * `/v1/mcps/:id/mcp` legacy route, which fronts it with a Streamable HTTP transport.
 *
 * Tool-list consistency model: the SDK snapshots this bridge's tools ONCE per session
 * (standard MCP — `tools/list` at connect, then only on `tools/list_changed`), so the
 * bridge must never gamble on the cache being warm at that single read. Instead:
 * - ListTools reads the shared cache only and never blocks on a server connect, so a
 *   dead/slow server can't stall session start (issue #16242). A cold cache returns `[]`
 *   and `listTools` itself kicks a non-blocking refresh.
 * - Every content change to that cache fires `McpCatalogService.onToolsCacheUpdated`;
 *   the bridge relays it as a `tools/list_changed` notification, and the SDK re-lists
 *   (verified against SDK 0.3.185: the CLI re-lists on the notification, debounced
 *   300ms, keeping the previous tool set if the re-list fails). One notification
 *   round-trip heals a session that started on a cold cache — including servers whose
 *   connect outlives the session-build warm — with zero blocking anywhere.
 */
export function createMcpBridgeServer(
  mcpId: string,
  serverSnapshot?: McpServerEntity,
  { listChanged = true, interactionContext }: McpBridgeOptions = {}
): Server {
  const serverConfig = serverSnapshot ?? mcpServerService.findByIdOrName(mcpId)
  if (!serverConfig) {
    throw new Error(`MCP server not found: ${mcpId}`)
  }

  const rawServer = new Server(
    { name: serverConfig.name, version: '0.1.0' },
    // `listChanged` is load-bearing twice over: the SDK client only attaches its re-list
    // handler for servers that declared it, and the local `sendToolListChanged` below
    // throws a capability error without it. Declaring it on a transport that cannot
    // deliver the notification is worse than not declaring it — the client would trust a
    // heal that never comes and serve a stale tool list indefinitely.
    {
      capabilities: {
        tools: listChanged ? { listChanged: true } : {},
        resources: listChanged ? { listChanged: true, subscribe: true } : {},
        prompts: listChanged ? { listChanged: true } : {}
      },
      instructions: application.get('McpRuntimeService').getConnectedServerInstructions(serverConfig.id)?.text
    }
  )

  // Relay cache updates for this server as `tools/list_changed` (see consistency model
  // above). Subscribe on `oninitialized` rather than at construction: a bridge that is
  // built but whose query never starts would otherwise leak the subscription forever,
  // and nothing is missed by subscribing late — the SDK's first tools/list happens after
  // `initialized` and reads the then-current cache. Unsubscribe when the SDK closes the
  // in-memory transport (driver close() → query.close() → transport.close()).
  let toolsCacheSubscription: { dispose: () => void } | undefined
  let catalogSubscription: { dispose: () => void } | undefined
  let resourceSubscription: { dispose: () => void } | undefined
  const observations = new Map<
    string,
    { abort: AbortController; ready: Promise<void>; lease?: McpResourceObservation }
  >()
  rawServer.oninitialized = () => {
    // Nothing to relay through on a transport that declared no `listChanged`; subscribing
    // anyway would only build notifications the client never asked for and cannot receive.
    if (!listChanged) return
    resourceSubscription ??= application.get('McpRuntimeService').onResourceUpdated(({ serverId, uri }) => {
      if (serverId === serverConfig.id && observations.has(uri)) {
        void rawServer.sendResourceUpdated({ uri }).catch(() => undefined)
      }
    })
    catalogSubscription ??= application.get('McpRuntimeService').onCatalogChanged(({ serverId, kind }) => {
      if (serverId !== serverConfig.id) return
      const notification = kind === 'prompts' ? rawServer.sendPromptListChanged() : rawServer.sendResourceListChanged()
      void notification.catch((error) => logger.debug('MCP bridge catalog notification failed', { mcpId, error }))
    })
    toolsCacheSubscription ??= application.get('McpCatalogService').onToolsCacheUpdated(({ serverId }) => {
      if (serverId !== serverConfig.id) return
      rawServer.sendToolListChanged().catch((error) => {
        // "Not connected" is the expected race between an emitter dispatch and transport
        // teardown — the session is going away, nothing to heal. Anything else means a live
        // session missed an invalidation (it re-syncs only if the cache changes again), so
        // keep it visible at warn.
        if (error instanceof Error && error.message.includes('Not connected')) {
          logger.debug('MCP bridge: tools/list_changed raced transport teardown', { mcpId })
        } else {
          logger.warn('MCP bridge: failed to send tools/list_changed', { mcpId, error })
        }
      })
    })
  }
  rawServer.onclose = () => {
    toolsCacheSubscription?.dispose()
    toolsCacheSubscription = undefined
    catalogSubscription?.dispose()
    catalogSubscription = undefined
    resourceSubscription?.dispose()
    resourceSubscription = undefined
    for (const entry of observations.values()) {
      entry.abort.abort()
      void entry.lease?.close()
    }
    observations.clear()
  }

  if (listChanged) {
    rawServer.setRequestHandler('resources/subscribe', async ({ params }, ctx) => {
      const existing = observations.get(params.uri)
      if (existing) {
        await existing.ready
        return {}
      }
      if (observations.size >= 128) throw new Error('MCP bridge subscription limit reached')
      const entry: { abort: AbortController; ready: Promise<void>; lease?: McpResourceObservation } = {
        abort: new AbortController(),
        ready: Promise.resolve()
      }
      observations.set(params.uri, entry)
      entry.ready = (async () => {
        const signal = AbortSignal.any([ctx.mcpReq.signal, entry.abort.signal, AbortSignal.timeout(10_000)])
        let acknowledge!: () => void
        let reject!: (error: Error) => void
        const ack = new Promise<void>((resolve, fail) => {
          acknowledge = resolve
          reject = fail
        })
        const cancel = () => reject(new Error('MCP bridge subscription cancelled'))
        signal.addEventListener('abort', cancel, { once: true })
        const opening = application
          .get('McpRuntimeService')
          .observeResource(serverConfig.id, params.uri, (state) => {
            if (state === 'subscribed') acknowledge()
            if (state === 'unsupported' || state === 'closed')
              reject(new Error('MCP resource subscription unavailable'))
            if (state === 'closed') {
              entry.abort.abort()
              if (observations.get(params.uri) === entry) observations.delete(params.uri)
              void entry.lease?.close()
            }
          })
          .then(async (lease) => {
            entry.lease = lease
            if (signal.aborted) await lease.close()
          })
        try {
          if (signal.aborted) cancel()
          await Promise.all([opening, ack])
        } catch (error) {
          entry.abort.abort()
          if (observations.get(params.uri) === entry) observations.delete(params.uri)
          await entry.lease?.close()
          throw error
        } finally {
          signal.removeEventListener('abort', cancel)
        }
      })()
      await entry.ready
      return {}
    })
    rawServer.setRequestHandler('resources/unsubscribe', async ({ params }) => {
      const entry = observations.get(params.uri)
      observations.delete(params.uri)
      entry?.abort.abort()
      await entry?.lease?.close()
      return {}
    })
  }

  const logged = async <T>(operation: string, fields: Record<string, unknown>, run: () => Promise<T>): Promise<T> => {
    logger.debug(`MCP bridge: ${operation}`, { mcpId, ...fields })
    try {
      return await run()
    } catch (error) {
      logger.error(`MCP bridge: failed ${operation}`, { mcpId, ...fields, error })
      throw error
    }
  }

  rawServer.setRequestHandler('tools/list', () =>
    logged('listing tools', {}, async () => ({
      tools: application.get('McpCatalogService').listTools(serverConfig.id, { includeDisabled: false }).map(toSdkTool)
    }))
  )

  rawServer.setRequestHandler('tools/call', async (request, ctx) => {
    const { signal } = ctx.mcpReq
    // Relay upstream progress only when the client asked for it — the protocol keys
    // progress notifications to the token it supplied, so without one there is nothing
    // to address them to.
    const progressToken = request.params._meta?.progressToken
    const onProgress =
      progressToken === undefined
        ? undefined
        : (progress: Progress) => {
            ctx.mcpReq
              .notify({ method: 'notifications/progress', params: { ...progress, progressToken } })
              .catch((error) => logger.debug('MCP bridge: progress notification dropped', { mcpId, error }))
          }

    try {
      logger.debug('MCP bridge: calling tool', { mcpId, tool: request.params.name })
      const result = await application.get('McpRuntimeService').callTool({
        serverId: serverConfig.id,
        name: request.params.name,
        args: request.params.arguments,
        onProgress,
        signal,
        interactionContext
      })
      return mcpLegacyResult(result)
    } catch (error) {
      if (isMcpCancellation(error, signal)) {
        // Expected cancellation from the SDK side — the runtime already logged it at debug.
        logger.debug('MCP bridge: tool call aborted', { mcpId, tool: request.params.name })
      } else {
        // Every agent runtime (dsh / pi / Claude Code) reaches Cherry's tools through this
        // handler, so this is the one place their tool failures are observable in-process.
        logger.error('MCP bridge: failed to call tool', {
          mcpId,
          tool: request.params.name,
          argsShape: redactToShape(request.params.arguments),
          err: chatErrorContext(error)
        })
      }
      throw error
    }
  })

  rawServer.setRequestHandler('resources/list', () =>
    logged('listing resources', {}, async () => ({
      resources: (await application.get('McpCatalogService').listResources(serverConfig.id)).map(stripCatalogFields)
    }))
  )

  rawServer.setRequestHandler('resources/templates/list', () =>
    logged('listing resource templates', {}, async () => ({
      resourceTemplates: (await application.get('McpCatalogService').listResourceTemplates(serverConfig.id)).map(
        stripCatalogFields
      )
    }))
  )

  rawServer.setRequestHandler('resources/read', (request, ctx) => {
    const { uri } = request.params
    return logged('reading resource', { uri }, async () => {
      const { contents } = await application
        .get('McpRuntimeService')
        .getResource({ serverId: serverConfig.id, uri, signal: ctx.mcpReq.signal, interactionContext })
      return { contents: contents.map(toSdkResourceContents) }
    })
  })

  rawServer.setRequestHandler('prompts/list', () =>
    logged('listing prompts', {}, async () => ({
      prompts: (await application.get('McpCatalogService').listPrompts(serverConfig.id)).map(stripCatalogFields)
    }))
  )

  rawServer.setRequestHandler('prompts/get', (request, ctx) => {
    const { name, arguments: args } = request.params
    return logged('getting prompt', { prompt: name }, () =>
      application.get('McpRuntimeService').getPrompt({
        serverId: serverConfig.id,
        name,
        args,
        signal: ctx.mcpReq.signal,
        interactionContext
      })
    )
  })

  logger.info(`Created SDK MCP bridge for "${serverConfig.name}"`)
  return rawServer
}
