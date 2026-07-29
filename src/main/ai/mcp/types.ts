import type { CallToolResult } from '@modelcontextprotocol/client'
import type { McpResource } from '@shared/types/mcp'

/**
 * MCP tool-call / resource protocol response shapes. Main-process only — the
 * renderer surfaces tool results via `McpToolResponse` (renderer types), not
 * these raw protocol shapes. Verified renderer-unused on both `main` and the
 * feat/chat-page (v2) branch.
 */
export type McpCallToolResponse = CallToolResult

export interface GetResourceResponse {
  contents: McpResource[]
}
