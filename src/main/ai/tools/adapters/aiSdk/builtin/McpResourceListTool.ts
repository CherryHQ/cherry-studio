/**
 * MCP resource browse tool — discovery half of the `mcp_resource_*` pair.
 *
 * Lists every resource reachable this request: the assistant's in-scope MCP servers that declared
 * the `resources` capability, intersected with the server ids frozen when the request was built
 * (see `RequestContext.mcpResourceServerIds`). The model picks a `(serverId, uri)` pair from here
 * and passes it to `mcp_resource_read`.
 *
 * Servers are request scope, not a model argument, so the tool takes no input.
 */

import { loggerService } from '@logger'
import {
  MCP_RESOURCE_LIST_TOOL_NAME,
  mcpResourceListInputSchema,
  mcpResourceListOutputSchema
} from '@shared/ai/builtinTools'
import { tool } from 'ai'

import { getToolCallContext } from '../context'
import { resolveMcpResourceServers } from '../mcp/resolveAssistantMcpTools'
import { listScopedMcpResources } from '../mcp/scopedResources'
import type { ToolEntry } from '../types'

const logger = loggerService.withContext('McpResourceListTool')

export const MCP_RESOURCE_LIST_DESCRIPTION =
  'List the resources exposed by the MCP servers available in this conversation (documents, files, ' +
  'database rows, anything the server publishes). Use it to discover a resource, then read the ' +
  'content with mcp_resource_read using the serverId and uri returned here — serverName is for ' +
  'display only and is not unique.'

const mcpResourceListTool = tool({
  description: MCP_RESOURCE_LIST_DESCRIPTION,
  inputSchema: mcpResourceListInputSchema,
  outputSchema: mcpResourceListOutputSchema,
  execute: async (_input, options) => {
    const { request } = getToolCallContext(options)
    const servers = resolveMcpResourceServers(request.assistant, request.mcpResourceServerIds)
    const resources = await listScopedMcpResources(servers)
    logger.debug('Listed MCP resources', { servers: servers.length, resources: resources.length })
    return { resources }
  }
})

export function createMcpResourceListToolEntry(): ToolEntry {
  return {
    name: MCP_RESOURCE_LIST_TOOL_NAME,
    namespace: 'mcp_resource',
    description: 'List the resources published by the conversation’s MCP servers',
    defer: 'auto',
    tool: mcpResourceListTool,
    applies: (scope) => (scope.mcpResourceServerIds?.size ?? 0) > 0
  }
}
