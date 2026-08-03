export type McpProgressEvent = {
  callId: string
  progress: number // 0-1 range
}

export type McpServerLogEntry = {
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error' | 'stderr' | 'stdout'
  message: string
  data?: any
  source?: string
}

/**
 * MCP tool descriptor as seen by the renderer through shared cache. Main
 * process `McpCatalogService` is the sole producer.
 */
export interface McpTool {
  /** Wire-name; `${serverName}__${toolName}` for server tools, synthetic for descriptor-only. */
  id: string
  /** Original protocol-level tool name. */
  name: string
  description?: string
  type: 'mcp'
  serverId: string
  serverName: string
  /** JSON-Schema-shaped input descriptor. After main's Zod transform,
   *  `properties` and `required` are populated; renderers (settings page)
   *  read them directly. */
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
  /** Optional JSON Schema output descriptor. MCP 2026 allows any JSON root,
   *  including arrays, strings, numbers, booleans and null. */
  outputSchema?: Record<string, unknown> | boolean
}

export interface McpPromptArguments {
  name: string
  description?: string
  required?: boolean
}

export interface McpPrompt {
  id: string
  name: string
  description?: string
  arguments?: McpPromptArguments[]
  serverId: string
  serverName: string
}

export interface McpResource {
  serverId: string
  serverName: string
  uri: string
  name: string
  description?: string
  mimeType?: string
  size?: number
  text?: string
  blob?: string
}

// McpCallToolResponse / McpToolResultContent / GetResourceResponse are
// main-process-only protocol shapes — they live in `src/main/ai/mcp/types.ts`.
