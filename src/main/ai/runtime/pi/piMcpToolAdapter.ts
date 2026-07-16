import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { loggerService } from '@logger'
import type { NeutralToolContent } from '@main/ai/agents/tools/types'
import type { McpCallToolResponse, McpToolResultContent } from '@main/ai/mcp/types'
import { buildFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpTool } from '@shared/types/mcp'

/**
 * pi adapter for the agent's selected MCP servers.
 *
 * Bridges each catalogued MCP tool into a pi `ToolDefinition` for `customTools`,
 * proxying the actual call to `McpRuntimeService` (the same runtime the claude
 * driver's SDK bridge uses — see `createSdkMcpServerInstance`). Unlike the soul
 * autonomy tools, these are THIRD-PARTY tools: they are NOT auto-approved, so
 * `PiRuntimeConnection` must never add their names to the approval extension's
 * `autoApprovedTools`. The approval gate handles them like any other tool — a
 * namespaced `mcp__…` name is neither read-only nor edit-class, so it falls
 * through to `requiresApproval` (prompts in default/acceptEdits, allowed in
 * bypassPermissions).
 *
 * `import type`-only for the pi SDK, so it needs no dynamic `loadPiSdk()` and is
 * safe in the CJS main bundle.
 */

const logger = loggerService.withContext('PiMcpToolAdapter')

/**
 * Build pi `ToolDefinition[]` for the tools of the given MCP server ids/names.
 *
 * - Unresolvable ids are skipped with a warning (a server can be deleted while an
 *   agent still references it).
 * - The catalog is warmed once via `refreshTools` so the first session after boot
 *   (cold cache) is not empty; `allSettled` keeps a dead/slow server from either
 *   blocking or failing session start (bounded by the runtime's own timeouts).
 * - Tools are then read cache-only via `listTools` (already source-policy filtered).
 */
export async function buildMcpToolDefinitions(mcpIds: string[]): Promise<ToolDefinition[]> {
  if (mcpIds.length === 0) return []

  const catalog = application.get('McpCatalogService')
  const runtimeService = application.get('McpRuntimeService')

  // Resolve ids → server records (dedup by id: a server selected twice must not mint
  // duplicate tool names). Skip + warn on unresolvable ids.
  const servers = new Map<string, McpServer>()
  for (const idOrName of mcpIds) {
    const server = mcpServerService.findByIdOrName(idOrName)
    if (!server) {
      logger.warn('Skipping unresolvable MCP server referenced by agent', { idOrName })
      continue
    }
    servers.set(server.id, server)
  }
  if (servers.size === 0) return []

  const resolved = [...servers.values()]
  await Promise.allSettled(resolved.map((server) => catalog.refreshTools(server.id)))

  return resolved.flatMap((server) =>
    catalog
      .listTools(server.id, { includeDisabled: false })
      .map((tool) => toMcpToolDefinition(server, tool, runtimeService))
  )
}

type McpRuntimeService = ReturnType<typeof application.get<'McpRuntimeService'>>

/** Map one catalogued MCP tool to a pi `ToolDefinition` that proxies to the runtime service. */
function toMcpToolDefinition(server: McpServer, tool: McpTool, runtimeService: McpRuntimeService): ToolDefinition {
  return {
    // Same wire name the claude path mints (`mcp__<server>__<tool>`), so tool ids match across runtimes.
    name: buildFunctionCallToolName(server.name, tool.name),
    label: tool.name,
    description: tool.description ?? '',
    // JSON Schema flows straight through; pi validates it without a TypeBox build (see piToolAdapter).
    parameters: tool.inputSchema as unknown as ToolDefinition['parameters'],
    async execute(_toolCallId, params, signal) {
      // Own callId so the runtime's per-call AbortController can be cancelled if pi aborts the turn.
      const callId = randomUUID()
      const onAbort = () => void runtimeService.abortTool(callId)
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        const result = await runtimeService.callTool({
          serverId: server.id,
          name: tool.name,
          args: params as Record<string, unknown>,
          callId
        })
        // MCP encodes soft failures as `isError` results; pi has no isError channel, so throw and
        // let the agent loop encode the message (mirrors piToolAdapter's soft-error handling).
        if (result.isError) throw new Error(joinErrorText(result.content))
        return { content: result.content.map(toPiContent), details: result.structuredContent }
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
    }
  }
}

/**
 * Map an MCP content block to pi's tool-result content. pi's `AgentToolResult.content` is
 * `(TextContent | ImageContent)[]` — it has no audio or embedded-resource channel — so audio and
 * resource blocks are flattened to a text summary rather than dropped silently.
 */
function toPiContent(part: McpToolResultContent): NeutralToolContent {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text ?? '' }
    case 'image':
      return { type: 'image', data: part.data ?? '', mimeType: part.mimeType ?? 'application/octet-stream' }
    case 'audio':
      return { type: 'text', text: `[audio content${part.mimeType ? ` (${part.mimeType})` : ''}]` }
    case 'resource':
      return { type: 'text', text: flattenResource(part.resource) }
  }
}

/** A resource block flattens to its embedded text when present, else a `[resource: <uri>]` summary. */
function flattenResource(resource: McpToolResultContent['resource']): string {
  if (!resource) return '[resource]'
  if (typeof resource.text === 'string') return resource.text
  const uri = resource.uri ?? 'unknown'
  return `[resource: ${uri}${resource.mimeType ? ` (${resource.mimeType})` : ''}]`
}

/** Join the text parts of an error result into the thrown message (image/resource blocks are dropped). */
function joinErrorText(content: McpCallToolResponse['content']): string {
  const text = content
    .map((part) => (part.type === 'text' ? (part.text ?? '') : ''))
    .filter(Boolean)
    .join('\n')
  return text || 'MCP tool returned an error'
}
