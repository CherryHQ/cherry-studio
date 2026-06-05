export type ToolType = 'builtin' | 'provider' | 'mcp'

/** Common shape shared by builtin/provider tools (non-MCP) when wrapped in
 *  `NormalToolResponse`. MCP tools have the richer `McpTool` shape below. */
export interface BaseTool {
  id: string
  name: string
  description?: string
  type: ToolType
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
  /** Optional JSON-Schema-shaped output descriptor. Set by main when the MCP
   *  server advertises one; passed through IPC for downstream consumers
   *  (AI SDK tool def / future settings inspection) even if no current
   *  renderer reads it. */
  outputSchema?: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
}
