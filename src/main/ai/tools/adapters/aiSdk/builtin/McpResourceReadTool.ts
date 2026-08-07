/**
 * MCP resource read tool — deep-read companion to `mcp_resource_list`.
 *
 * The model passes a `uri` from `mcp_resource_list` (or from a resource the user attached in the
 * composer, whose chip carries the uri). The owning server is resolved from the request's in-scope
 * resource servers, never from the model.
 */

import {
  MCP_RESOURCE_READ_TOOL_NAME,
  mcpResourceReadInputSchema,
  mcpResourceReadResultSchema
} from '@shared/ai/builtinTools'
import { tool } from 'ai'

import { getToolCallContext } from '../context'
import { resolveMcpResourceServers } from '../mcp/resolveAssistantMcpTools'
import { readScopedMcpResource } from '../mcp/scopedResources'
import type { ToolEntry } from '../types'

export const MCP_RESOURCE_READ_DESCRIPTION =
  'Read the content of an MCP resource by uri. Pass a uri returned by mcp_resource_list, or one the ' +
  'user attached to the conversation.'

const mcpResourceReadTool = tool({
  description: MCP_RESOURCE_READ_DESCRIPTION,
  inputSchema: mcpResourceReadInputSchema,
  outputSchema: mcpResourceReadResultSchema,
  strict: true,
  execute: async ({ uri }, options) => {
    const { request } = getToolCallContext(options)
    return readScopedMcpResource(resolveMcpResourceServers(request.assistant), uri)
  }
})

export function createMcpResourceReadToolEntry(): ToolEntry {
  return {
    name: MCP_RESOURCE_READ_TOOL_NAME,
    namespace: 'mcp_resource',
    description: 'Read one MCP resource by uri',
    // Read-style tool: persisting its output would route the model straight back through it to read
    // the persisted file, same reasoning as fs_read / kb_read.
    truncatable: false,
    defer: 'auto',
    tool: mcpResourceReadTool,
    applies: (scope) => (scope.mcpResourceServerIds?.size ?? 0) > 0
  }
}
