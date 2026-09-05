import { application } from '@application'
import { loggerService } from '@logger'
import type { McpCallToolResponse } from '@main/ai/mcp/types'
import { mcpServerService } from '@main/data/services/McpServerService'
import { isMcpToolForcePromptBySource } from '@shared/ai/tools/mcpSourcePolicy'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpTool } from '@shared/types/mcp'
import { type JSONSchema7, type Tool } from 'ai'

import { getRequestContext } from '../context'
import { createMcpInputSchema } from '../mcpSchema'
import { registry, type ToolRegistry } from '../registry'
import type { ToolEntry } from '../types'
import { mcpResultToTextSummary } from './utils'

const logger = loggerService.withContext('mcpTools')

const namespaceForServer = (serverId: string) => `mcp:${serverId}`

function resolveActiveServerById(serverId: string): McpServer | undefined {
  // Direct point lookup instead of listing every active server on each tool call.
  let server: McpServer | undefined
  try {
    server = mcpServerService.getById(serverId)
  } catch {
    server = undefined
  }
  return server?.isActive ? server : undefined
}

/** Build the AI SDK Tool wrapper around a single McpTool. */
function createMcpTool(mcpTool: McpTool, forcePrompt: boolean): Tool {
  const metadata = {
    description: mcpTool.description,
    name: mcpTool.name,
    serverId: mcpTool.serverId,
    serverName: mcpTool.serverName,
    type: 'mcp' as const
  }
  return {
    type: 'function',
    description: mcpTool.description || mcpTool.name,
    metadata: { cherry: { tool: metadata } },
    inputSchema: createMcpInputSchema(mcpTool.inputSchema as JSONSchema7),
    needsApproval: async () => forcePrompt,
    execute: async (args: Record<string, unknown>, options) => {
      const { toolCallId, abortSignal } = options
      const server = resolveActiveServerById(mcpTool.serverId)
      if (!server) {
        throw new Error(`MCP server ${mcpTool.serverId} is not active or no longer registered`)
      }
      const result: McpCallToolResponse = await application.get('McpRuntimeService').callTool({
        serverId: server.id,
        name: mcpTool.name,
        args,
        callId: toolCallId,
        // Isolation scope for abort-by-id: provider call ids (e.g. "call_0") can collide
        // across topics, and the renderer's abort presents the same topicId.
        scope: getRequestContext(options)?.topicId,
        signal: abortSignal
      })

      if (result.isError) {
        throw new Error(mcpResultToTextSummary(result) || 'MCP tool call failed')
      }

      // Full McpCallToolResponse for the renderer's ToolUIPart (multimodal
      // parts intact); `toModelOutput` below produces the string view.
      return {
        ...result,
        metadata
      }
    },
    toModelOutput({ output }) {
      const result = output as McpCallToolResponse
      return { type: 'text' as const, value: mcpResultToTextSummary(result) }
    }
  }
}

function toEntry(mcpTool: McpTool, server: McpServer): ToolEntry {
  // A force-prompt (approval-gated) tool must never defer: deferring removes it from the SDK
  // tool-set, so the SDK's native `needsApproval` gate never fires and it becomes reachable only
  // via `tool_invoke` — which would run it with no approval card. Keep it inline. Reading
  // `forcePrompt` once keeps `defer` and `needsApproval` in lock-step (they must always agree).
  const forcePrompt = isMcpToolForcePromptBySource(server, mcpTool)
  return {
    name: mcpTool.id,
    namespace: namespaceForServer(server.id),
    namespaceLabel: `mcp:${server.name}`,
    description: mcpTool.description || mcpTool.name,
    defer: forcePrompt ? 'never' : 'auto',
    tool: createMcpTool(mcpTool, forcePrompt),
    applies: (scope) => scope.mcpToolIds.has(mcpTool.id)
  }
}

export interface SyncMcpToolsToRegistryOptions {
  /**
   * Restrict registration to exact selected tool ids. Ownership is resolved
   * from each active server's cache-only catalog; stale-server cleanup still
   * runs globally. Omit for full reconcile (bootstrap / admin).
   */
  readonly selectedToolIds?: ReadonlySet<string>
}

/**
 * Reconcile the registry against the live server snapshot. Adds new
 * tools, replaces existing (so schema changes take effect), drops
 * deactivated — covers server uninstall and `tools/list_changed`
 * without subscribing to events.
 */
export async function syncMcpToolsToRegistry(
  reg: ToolRegistry = registry,
  opts: SyncMcpToolsToRegistryOptions = {}
): Promise<void> {
  const { items: activeServers } = mcpServerService.list({ isActive: true })
  const selectedToolIds = opts.selectedToolIds
  const targetNamespaces = new Set<string>()
  const activeNamespaces = new Set(activeServers.map((server) => namespaceForServer(server.id)))
  // Only namespaces whose `listTools` actually succeeded. A transient connection drop
  // must NOT evict a still-active server's previously-registered tools — without this
  // guard the eviction loop below sees every prior tool as `missing` and deregisters them.
  const refreshedNamespaces = new Set<string>()
  const freshNames = new Set<string>()

  if (selectedToolIds) {
    for (const entry of reg.getAll()) {
      if (selectedToolIds.has(entry.name) && entry.namespace.startsWith('mcp:')) {
        targetNamespaces.add(entry.namespace)
      }
    }
  }

  for (const server of activeServers) {
    // Every selection is accounted for, so no later server can own one — skip the
    // remaining catalog reads (and leave their namespaces out of the eviction scope).
    if (selectedToolIds && freshNames.size === selectedToolIds.size) break
    const namespace = namespaceForServer(server.id)
    try {
      const enabledTools = application.get('McpCatalogService').listTools(server.id, { includeDisabled: false })
      const scopedTools = selectedToolIds ? enabledTools.filter((tool) => selectedToolIds.has(tool.id)) : enabledTools
      if (!selectedToolIds || scopedTools.length > 0) targetNamespaces.add(namespace)
      for (const mcpTool of scopedTools) {
        // A wire id encodes serverId + protocol tool name, so a repeat can only be the
        // same identity listed twice by one server. First wins.
        if (freshNames.has(mcpTool.id)) continue
        reg.register(toEntry(mcpTool, server))
        freshNames.add(mcpTool.id)
      }
      refreshedNamespaces.add(namespace)
    } catch (error) {
      logger.error('Failed to list MCP tools for server', {
        serverId: server.id,
        serverName: server.name,
        error
      })
    }
  }

  for (const entry of reg.getAll()) {
    if (!entry.namespace.startsWith('mcp:')) continue
    const serverDeactivated = !activeNamespaces.has(entry.namespace)
    // Gate the in-scope eviction on a successful refresh, so a failed `listTools` leaves
    // the prior snapshot intact. A truly deactivated server is still evicted regardless.
    const inSyncScope = targetNamespaces.has(entry.namespace) && refreshedNamespaces.has(entry.namespace)
    const missing = !freshNames.has(entry.name)
    const missingFromSelectedSync = selectedToolIds ? selectedToolIds.has(entry.name) : true
    if (serverDeactivated || (inSyncScope && missing && missingFromSelectedSync)) {
      reg.deregister(entry.name)
    }
  }
}
