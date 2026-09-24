import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { McpInteractionContext } from '@main/ai/mcp/connections/McpConnection'
import { createMcpBridgeServer } from '@main/ai/mcp/createMcpBridgeServer'
import type { McpServer as McpServerEntity } from '@shared/data/types/mcpServer'

/** Adapts the shared MCP v1 bridge to the Claude Agent SDK entry point. */
export function createSdkMcpServerInstance(
  mcpId: string,
  serverSnapshot?: McpServerEntity,
  interactionContext?: McpInteractionContext
): McpServer {
  return createMcpBridgeServer(mcpId, serverSnapshot, { interactionContext })
}
