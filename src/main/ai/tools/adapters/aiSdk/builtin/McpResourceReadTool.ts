/**
 * MCP resource read tool — deep-read companion to `mcp_resource_list`.
 *
 * The model passes a `(serverName, uri)` pair from `mcp_resource_list` (or from a resource the user
 * attached in the composer, whose chip carries both). The server is resolved from the request's
 * frozen scope, and the uri must appear in that server's published list — neither is taken on the
 * model's word.
 *
 * Being `truncatable: false`, this tool caps its own output: a page is at most the request's
 * tool-output cap, and `nextOffset` continues it. Without that, an arbitrarily large resource would
 * land whole in the model's context with no layer left to trim it.
 */

import {
  MCP_RESOURCE_READ_CHAR_CAP,
  MCP_RESOURCE_READ_TOOL_NAME,
  mcpResourceReadInputSchema,
  mcpResourceReadResultSchema
} from '@shared/ai/builtinTools'
import { tool } from 'ai'

import { getToolCallContext } from '../context'
import { isMcpResourceReadForcePrompt, resolveMcpResourceServers } from '../mcp/resolveAssistantMcpTools'
import { readScopedMcpResource } from '../mcp/scopedResources'
import type { ToolEntry } from '../types'

export const MCP_RESOURCE_READ_DESCRIPTION =
  'Read the content of an MCP resource. Pass the serverName and uri exactly as returned by ' +
  'mcp_resource_list, or as carried by a resource the user attached. Long resources come back one ' +
  'page at a time — continue with the returned nextOffset.'

const mcpResourceReadTool = tool({
  description: MCP_RESOURCE_READ_DESCRIPTION,
  inputSchema: mcpResourceReadInputSchema,
  outputSchema: mcpResourceReadResultSchema,
  needsApproval: async (_input, options) => {
    // Wildcard-gated servers prompt for every tool call; reading their resources must not be the one
    // silent path. Fail closed: without request context there is no policy to read, so prompt.
    try {
      const { request } = getToolCallContext(options)
      return resolveMcpResourceServers(request.assistant, request.mcpResourceServerIds).some(
        isMcpResourceReadForcePrompt
      )
    } catch {
      return true
    }
  },
  execute: async ({ serverName, uri, offset }, options) => {
    const { request } = getToolCallContext(options)
    return readScopedMcpResource(resolveMcpResourceServers(request.assistant, request.mcpResourceServerIds), {
      serverName,
      uri,
      offset,
      charCap: request.toolOutputCharCap ?? MCP_RESOURCE_READ_CHAR_CAP,
      signal: request.abortSignal
    })
  }
})

export function createMcpResourceReadToolEntry(): ToolEntry {
  return {
    name: MCP_RESOURCE_READ_TOOL_NAME,
    namespace: 'mcp_resource',
    description: 'Read one MCP resource by server name and uri',
    // Read-style tool: persisting its output would route the model straight back through it to read
    // the persisted file, same reasoning as fs_read / kb_read. It caps its own pages instead.
    truncatable: false,
    // Approval-gated entries must never defer: deferring removes the tool from the SDK tool-set, so
    // the native `needsApproval` gate never fires and it becomes reachable via `tool_invoke` with no
    // approval card (same rule as force-prompt MCP tools).
    defer: 'never',
    tool: mcpResourceReadTool,
    applies: (scope) => (scope.mcpResourceServerIds?.size ?? 0) > 0
  }
}
