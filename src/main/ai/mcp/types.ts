import type { McpResource } from '@shared/types/mcp'

/**
 * MCP tool-call / resource protocol response shapes. Main-process only — the
 * renderer surfaces tool results via `McpToolResponse` (renderer types), not
 * these raw protocol shapes. Verified renderer-unused on both `main` and the
 * feat/chat-page (v2) branch.
 */
export interface McpToolResultContent {
  type: 'text' | 'image' | 'audio' | 'resource'
  text?: string
  data?: string
  mimeType?: string
  resource?: {
    uri?: string
    text?: string
    mimeType?: string
    blob?: string
  }
}

export interface McpCallToolResponse {
  content: McpToolResultContent[]
  structuredContent?: unknown
  isError?: boolean
}

export interface GetResourceResponse {
  contents: McpResource[]
}
